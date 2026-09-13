import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zonedDayKey } from '@platform/shared/clock';
import { assets, automations, employees, locations, users } from '../src/db/schema/index.js';
import { withTenant } from '../src/db/tenant.js';
import { runWithContext } from '../src/lib/context.js';
import type { RecordingMailer } from '../src/services/reports/mail.service.js';
import { buildTestApp, integrationEnabled, login, type TestApp } from './helpers/build-test-app.js';

if (!integrationEnabled) console.log('TEST_DATABASE_URL not set: skipping sweep tests');

const LIGHT_ID = '66666666-6666-4666-8666-666666666601';
const AC_ID = '66666666-6666-4666-8666-666666666602';
const LAPTOP_ID = '66666666-6666-4666-8666-666666666603';

describe.skipIf(!integrationEnabled)(
  'evening sweep, late worker actions, holds and the morning report (integration)',
  () => {
    let t: TestApp;
    const auth = (token: string) => ({ host: 'alpha.localhost', authorization: `Bearer ${token}` });
    const internal = () => ({ 'x-internal-token': t.config.INTERNAL_API_TOKEN });
    let opsToken: string;

    async function event(payload: Record<string, unknown>) {
      const res = await t.fastify.inject({
        method: 'POST',
        url: '/internal/tb/events',
        headers: internal(),
        payload,
      });
      expect(res.statusCode).toBe(204);
    }
    const telemetry = (id: string, name: string, type: string, data: Record<string, unknown>) => ({
      type: 'telemetry',
      originator: { id, entityType: 'DEVICE', name, type },
      ts: Date.now(),
      data,
      metadata: {},
    });

    beforeAll(async () => {
      t = await buildTestApp();
      await runWithContext({ requestId: 'system', tenantId: t.alpha.id, tenantKey: 'alpha' }, () =>
        withTenant(t.db.app, t.alpha.id, async (tx) => {
          const [room] = await tx.select().from(locations).where(eq(locations.type, 'ROOM'));
          const [employee] = await tx
            .insert(employees)
            .values({
              tenantId: t.alpha.id,
              code: 'E001',
              name: 'Yusuf Rahman',
              department: 'Engineering',
              deskRoomId: room!.id,
              zone: '1.West',
              email: 'yusuf.rahman@alpha.demo',
            })
            .returning();
          // the ops manager is the late worker
          await tx
            .update(users)
            .set({ employeeId: employee!.id })
            .where(eq(users.email, 'ops@alpha.demo'));
          await tx.insert(automations).values(
            ['evening_sweep', 'peak_shedding', 'precool', 'holiday_mode'].map((key) => ({
              tenantId: t.alpha.id,
              key,
              enabled: true,
              params: {},
            })),
          );
          await tx.insert(assets).values([
            {
              tenantId: t.alpha.id,
              code: 'LIGHT-1.1',
              name: 'Light 1.1',
              class: 'device',
              type: 'light',
              deviceType: 'light',
              tbDeviceId: LIGHT_ID,
              locationId: room!.id,
              meta: {},
            },
            {
              tenantId: t.alpha.id,
              code: 'AC-1.1',
              name: 'AC 1.1',
              class: 'device',
              type: 'ac',
              deviceType: 'ac',
              tbDeviceId: AC_ID,
              locationId: room!.id,
              meta: {},
            },
            {
              tenantId: t.alpha.id,
              code: 'LAPTOP-E001',
              name: 'Laptop E001',
              class: 'laptop',
              type: 'laptop',
              deviceType: 'laptop',
              tbDeviceId: LAPTOP_ID,
              locationId: room!.id,
              custodianEmployeeId: employee!.id,
              meta: {},
            },
          ]);
        }),
      );
      await event(telemetry(LIGHT_ID, 'LIGHT-1.1', 'light', { state: 1, power_w: 60 }));
      await event(telemetry(AC_ID, 'AC-1.1', 'ac', { state: 1, power_w: 900, setpoint_c: 23 }));
      await event(telemetry(LAPTOP_ID, 'LAPTOP-E001', 'laptop', { ap: 'AP-1W', battery: 80 }));
      opsToken = await login(t, 'alpha.localhost', 'ops@alpha.demo');
    });
    afterAll(async () => {
      await t?.close();
    });

    it('the sweep keeps the late worker’s zone, notifies them, and the actions hold or release it', async () => {
      const run = await t.fastify.inject({
        method: 'POST',
        url: '/automations/evening_sweep/run',
        headers: auth(opsToken),
        payload: {},
      });
      expect(run.statusCode).toBe(200);
      const summary = run.json().summary;
      expect(summary.roomsSkipped).toEqual([
        { room: '1.1', reason: 'laptop_online', detail: 'Yusuf Rahman' },
      ]);
      expect(summary.zonesKept).toEqual([{ zone: '1.West', employee: 'Yusuf Rahman' }]);
      expect(summary.notified).toBe(1);
      expect(summary.actedDay).toBe(zonedDayKey(Date.now(), 'Asia/Dubai'));
      expect(t.rpcCalls).toEqual([]);

      const list = await t.fastify.inject({
        method: 'GET',
        url: '/notifications',
        headers: auth(opsToken),
      });
      const late = list.json().items.find((n: { kind: string }) => n.kind === 'sweep.late_worker');
      expect(late).toMatchObject({
        subject: 'sweep:1.West',
        actions: [
          { key: 'snooze', label: 'Still working' },
          { key: 'leave', label: 'Leaving now' },
        ],
      });

      // Still working: a one-hour hold on the zone
      const snooze = await t.fastify.inject({
        method: 'POST',
        url: `/notifications/${late.id}/act`,
        headers: auth(opsToken),
        payload: { key: 'snooze' },
      });
      expect(snooze.statusCode).toBe(200);
      expect(snooze.json().actedKey).toBe('snooze');
      const holds = await t.fastify.inject({
        method: 'GET',
        url: '/holds',
        headers: auth(opsToken),
      });
      expect(holds.json().items).toHaveLength(1);
      expect(holds.json().items[0]).toMatchObject({
        scopeType: 'ZONE',
        scopeId: '1.West',
        reason: 'Still working',
      });

      // Leaving now: the hold goes, the zone is swept although the laptop is still online
      const leave = await t.fastify.inject({
        method: 'POST',
        url: `/notifications/${late.id}/act`,
        headers: auth(opsToken),
        payload: { key: 'leave' },
      });
      expect(leave.statusCode).toBe(200);
      expect(
        (await t.fastify.inject({ method: 'GET', url: '/holds', headers: auth(opsToken) })).json()
          .items,
      ).toEqual([]);
      expect(t.rpcCalls.map((c) => `${c.deviceId}:${JSON.stringify(c.params)}`).sort()).toEqual(
        [`${LIGHT_ID}:{"state":0}`, `${AC_ID}:{"state":0}`].sort(),
      );
      const runs = await t.fastify.inject({
        method: 'GET',
        url: '/automations/runs?key=evening_sweep',
        headers: auth(opsToken),
      });
      expect(runs.json().items[0]).toMatchObject({
        trigger: 'leave',
        summary: { roomsOff: ['1.1'] },
      });
      // the zone-scoped run does not count as the day's sweep
      expect(runs.json().items[0].summary.actedDay).toBeUndefined();
    });

    it('holds can be created for an event and removed; viewers may not', async () => {
      const viewer = await login(t, 'alpha.localhost', 'viewer@alpha.demo');
      const until = new Date(Date.now() + 3 * 3_600_000).toISOString();
      const denied = await t.fastify.inject({
        method: 'POST',
        url: '/holds',
        headers: auth(viewer),
        payload: { scopeType: 'FLOOR', scopeId: '1', until, reason: 'Event tonight' },
      });
      expect(denied.statusCode).toBe(403);
      const created = await t.fastify.inject({
        method: 'POST',
        url: '/holds',
        headers: auth(opsToken),
        payload: { scopeType: 'FLOOR', scopeId: '1', until, reason: 'Event tonight' },
      });
      expect(created.statusCode).toBe(201);
      const past = await t.fastify.inject({
        method: 'POST',
        url: '/holds',
        headers: auth(opsToken),
        payload: {
          scopeType: 'FLOOR',
          scopeId: '1',
          until: new Date(Date.now() - 1000).toISOString(),
          reason: 'x',
        },
      });
      expect(past.statusCode).toBe(400);
      const removed = await t.fastify.inject({
        method: 'DELETE',
        url: `/holds/${created.json().id}`,
        headers: auth(opsToken),
      });
      expect(removed.statusCode).toBe(204);
    });

    it('peak shedding can be shed and restored by hand and reports its state', async () => {
      const before = await t.fastify.inject({
        method: 'GET',
        url: '/automations/peak/state',
        headers: auth(opsToken),
      });
      expect(before.json()).toMatchObject({
        state: { status: 'NORMAL', level: 0 },
        thresholdKw: 150,
      });
      const shed = await t.fastify.inject({
        method: 'POST',
        url: '/automations/peak_shedding/run',
        headers: auth(opsToken),
        payload: { action: 'shed' },
      });
      expect(shed.statusCode).toBe(200);
      expect(shed.json().summary.shedState).toMatchObject({ status: 'SHEDDING', level: 1 });
      const during = await t.fastify.inject({
        method: 'GET',
        url: '/automations/peak/state',
        headers: auth(opsToken),
      });
      expect(during.json().state.level).toBe(1);
      const restore = await t.fastify.inject({
        method: 'POST',
        url: '/automations/peak_shedding/run',
        headers: auth(opsToken),
        payload: { action: 'restore' },
      });
      expect(restore.json().summary.shedState).toMatchObject({ status: 'NORMAL', level: 0 });
    });

    it('the morning report is stored, emailed to operations with the brand, and readable by finance', async () => {
      const today = zonedDayKey(Date.now(), 'Asia/Dubai');
      const viewer = await login(t, 'alpha.localhost', 'viewer@alpha.demo');
      expect(
        (
          await t.fastify.inject({
            method: 'POST',
            url: '/reports/morning/run',
            headers: auth(viewer),
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      const run = await t.fastify.inject({
        method: 'POST',
        url: '/reports/morning/run',
        headers: auth(opsToken),
        payload: { period: today },
      });
      expect(run.statusCode).toBe(200);
      const report = run.json();
      expect(report).toMatchObject({ kind: 'morning', period: today });
      expect(report.data.sweep).toMatchObject({
        roomsSkipped: [{ room: '1.1', reason: 'laptop_online', detail: 'Yusuf Rahman' }],
        zonesKept: [{ zone: '1.West', employee: 'Yusuf Rahman' }],
      });
      expect(report.data.emailedTo).toEqual(['ops@alpha.demo']);
      const mailer = t.container.mailer as RecordingMailer;
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]!.to).toEqual(['ops@alpha.demo']);
      expect(mailer.sent[0]!.html).toContain('Alpha');
      expect(mailer.sent[0]!.html).toContain(t.alpha.brand.primaryColor);

      const finance = await login(t, 'alpha.localhost', 'finance@alpha.demo');
      const list = await t.fastify.inject({
        method: 'GET',
        url: '/reports?kind=morning',
        headers: auth(finance),
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().items).toHaveLength(1);
      const one = await t.fastify.inject({
        method: 'GET',
        url: `/reports/${report.id}`,
        headers: auth(finance),
      });
      expect(one.json().period).toBe(today);
      // regenerating replaces the day's report instead of adding a second one
      await t.fastify.inject({
        method: 'POST',
        url: '/reports/morning/run',
        headers: auth(opsToken),
        payload: { period: today },
      });
      expect(
        (await t.fastify.inject({ method: 'GET', url: '/reports', headers: auth(finance) })).json()
          .total,
      ).toBe(1);
    });

    it('a phone on the bare host reaches a demo tenant with X-Tenant-Key, not a real one', async () => {
      const me = await t.fastify.inject({
        method: 'GET',
        url: '/me',
        headers: {
          host: 'localhost:8081',
          'x-tenant-key': 'alpha',
          authorization: `Bearer ${opsToken}`,
        },
      });
      expect(me.statusCode).toBe(200);
      const beta = await t.fastify.inject({
        method: 'GET',
        url: '/branding',
        headers: { host: 'localhost:8081', 'x-tenant-key': 'beta' },
      });
      expect(beta.statusCode).toBe(404);
    });

    it('a scheduled tick that decides nothing leaves no run behind but shows as checked', async () => {
      const before = (
        await t.fastify.inject({ method: 'GET', url: '/automations/runs', headers: auth(opsToken) })
      ).json().total as number;
      const tenant = {
        id: t.alpha.id,
        key: 'alpha',
        tariffPerKwh: Number(t.alpha.tariffPerKwh),
        demoMode: t.alpha.demoMode,
      };
      const recorded = await runWithContext(
        { requestId: 'tick', tenantId: t.alpha.id, tenantKey: 'alpha' },
        () => t.container.engine.run(tenant, { trigger: 'schedule' }),
      );
      // no bookings to pre-cool for, no holiday, no floor meter: nothing to record for these
      const quiet = ['precool', 'holiday_mode', 'peak_shedding'];
      expect(recorded.map((r) => r.key).filter((k) => quiet.includes(k))).toEqual([]);
      const after = (
        await t.fastify.inject({ method: 'GET', url: '/automations/runs', headers: auth(opsToken) })
      ).json().total as number;
      expect(after - before).toBe(recorded.length);

      const list = await t.fastify.inject({
        method: 'GET',
        url: '/automations',
        headers: auth(opsToken),
      });
      const precool = list.json().items.find((a: { key: string }) => a.key === 'precool');
      expect(precool.lastRun).toBeNull();
      expect(precool.lastCheck).toMatchObject({ recorded: false });
      expect(Date.now() - Date.parse(precool.lastCheck.at)).toBeLessThan(60_000);
    });
  },
);
