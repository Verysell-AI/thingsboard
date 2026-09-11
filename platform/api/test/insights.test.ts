import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zonedDayKey } from '@platform/shared/clock';
import {
  assets,
  automations,
  deviceNightlyStats,
  employees,
  locations,
  roomDailyStats,
  roomHourlyStats,
} from '../src/db/schema/index.js';
import { withTenant } from '../src/db/tenant.js';
import { runWithContext } from '../src/lib/context.js';
import { buildTestApp, integrationEnabled, login, type TestApp } from './helpers/build-test-app.js';

if (!integrationEnabled) console.log('TEST_DATABASE_URL not set: skipping insights tests');

const AC_ID = '55555555-5555-4555-8555-555555555501';
const MONITOR_ID = '55555555-5555-4555-8555-555555555502';
const LAPTOP_ID = '55555555-5555-4555-8555-555555555503';

describe.skipIf(!integrationEnabled)(
  'insights: maintenance from alarms, standby, fleet, utilisation, reports (integration)',
  () => {
    let t: TestApp;
    const auth = (token: string) => ({ host: 'alpha.localhost', authorization: `Bearer ${token}` });
    const internal = () => ({ 'x-internal-token': t.config.INTERNAL_API_TOKEN });
    let ops: string;
    let acAssetId = '';
    let monitorAssetId = '';

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
              name: 'Amira Haddad',
              department: 'Sales',
              deskRoomId: room!.id,
              zone: '1.West',
              email: 'amira@alpha.demo',
            })
            .returning();
          const rows = await tx
            .insert(assets)
            .values([
              {
                tenantId: t.alpha.id,
                code: 'AC-1.1',
                name: 'AC 1.1',
                class: 'device',
                type: 'ac',
                deviceType: 'ac',
                tbDeviceId: AC_ID,
                locationId: room!.id,
                category: 'HVAC',
                purchaseCost: '2400',
                purchaseDate: '2024-01-01',
                usefulLifeYears: 10,
                warrantyEnd: '2026-10-01',
                meta: { nominalCurrentA: 3.4 },
              },
              {
                tenantId: t.alpha.id,
                code: 'PLUG-1.1-MON',
                name: 'Monitor plug',
                class: 'device',
                type: 'plug',
                deviceType: 'plug',
                tbDeviceId: MONITOR_ID,
                locationId: room!.id,
                category: 'Metering',
                purchaseCost: '45',
                purchaseDate: '2023-06-01',
                usefulLifeYears: 5,
                meta: { appliance: 'monitor', sweepable: true },
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
                category: 'IT equipment',
                purchaseCost: '5200',
                purchaseDate: '2023-09-01',
                usefulLifeYears: 4,
                warrantyEnd: '2026-09-25',
                meta: {},
              },
            ])
            .returning();
          acAssetId = rows.find((r) => r.code === 'AC-1.1')!.id;
          monitorAssetId = rows.find((r) => r.code === 'PLUG-1.1-MON')!.id;
          await tx.insert(automations).values({
            tenantId: t.alpha.id,
            key: 'holiday_mode',
            enabled: true,
            params: { dates: ['2026-12-02'] },
          });
          // seven idle nights for the monitor plug
          for (let i = 1; i <= 7; i++) {
            const date = zonedDayKey(Date.now() - i * 86_400_000, 'Asia/Dubai');
            await tx.insert(deviceNightlyStats).values({
              tenantId: t.alpha.id,
              assetId: monitorAssetId,
              date,
              avgNightPowerW: '6.10',
              hoursAbove5w: '8.00',
            });
          }
          // two weekdays of statistics for utilisation and cost allocation
          for (const date of ['2026-09-07', '2026-09-08']) {
            await tx.insert(roomDailyStats).values({
              tenantId: t.alpha.id,
              roomId: room!.id,
              date,
              occupiedMinutes: 300,
              bookedMinutes: 360,
              ghostCount: 1,
              kwh: '4.5',
              wastedKwh: '0.7',
            });
            await tx.insert(roomHourlyStats).values(
              [9, 10, 11, 14, 15].map((hour) => ({
                tenantId: t.alpha.id,
                roomId: room!.id,
                date,
                hour,
                occupiedMinutes: 60,
                bookedMinutes: 60,
              })),
            );
          }
        }),
      );
      ops = await login(t, 'alpha.localhost', 'ops@alpha.demo');
    });
    afterAll(async () => {
      await t?.close();
    });

    it('an AC current alarm opens one maintenance task on the unit, notifies operations, and clearing adds a note', async () => {
      const alarm = (type: string, status: 'alarm_created' | 'alarm_cleared') => ({
        type: status,
        originator: { id: AC_ID, entityType: 'DEVICE', name: 'AC-1.1', type: 'ac' },
        ts: Date.now(),
        data: { type, severity: 'MAJOR', id: 'alarm-1' },
        metadata: {},
      });
      expect(
        (
          await t.fastify.inject({
            method: 'POST',
            url: '/internal/tb/events',
            headers: internal(),
            payload: alarm('AC current high', 'alarm_created'),
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (
          await t.fastify.inject({
            method: 'POST',
            url: '/internal/tb/events',
            headers: internal(),
            payload: alarm('AC current high', 'alarm_created'),
          })
        ).statusCode,
      ).toBe(204);
      const list = await t.fastify.inject({
        method: 'GET',
        url: '/maintenance',
        headers: auth(ops),
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().items).toHaveLength(1);
      const task = list.json().items[0];
      expect(task).toMatchObject({
        status: 'OPEN',
        title: 'Check filter: AC-1.1',
        createdFromAlarmId: 'alarm-1',
        asset: { code: 'AC-1.1', room: '1.1' },
      });
      const notes = await t.fastify.inject({
        method: 'GET',
        url: '/notifications',
        headers: auth(ops),
      });
      expect(notes.json().items.some((n: { kind: string }) => n.kind === 'maintenance.task')).toBe(
        true,
      );

      await t.fastify.inject({
        method: 'POST',
        url: '/internal/tb/events',
        headers: internal(),
        payload: alarm('AC current high', 'alarm_cleared'),
      });
      const after = await t.fastify.inject({
        method: 'GET',
        url: `/maintenance/${task.id}`,
        headers: auth(ops),
      });
      expect(after.json().status).toBe('OPEN');
      expect(after.json().notes).toContain('Alarm cleared');

      const health = await t.fastify.inject({
        method: 'GET',
        url: '/energy/ac-health',
        headers: auth(ops),
      });
      expect(health.json().items[0]).toMatchObject({
        code: 'AC-1.1',
        openTaskId: task.id,
        nominalCurrentA: 3.4,
      });

      const done = await t.fastify.inject({
        method: 'PATCH',
        url: `/maintenance/${task.id}`,
        headers: auth(ops),
        payload: { status: 'DONE', notes: 'Filter replaced' },
      });
      expect(done.json()).toMatchObject({ status: 'DONE', notes: 'Filter replaced' });
      expect(done.json().closedAt).not.toBeNull();
      const viewer = await login(t, 'alpha.localhost', 'viewer@alpha.demo');
      expect(
        (
          await t.fastify.inject({
            method: 'POST',
            url: '/maintenance',
            headers: auth(viewer),
            payload: { assetId: acAssetId, title: 'x' },
          })
        ).statusCode,
      ).toBe(403);
    });

    it('the standby hunt lists the idle monitor with yearly cost and an audited acknowledgement', async () => {
      const report = await t.fastify.inject({
        method: 'GET',
        url: '/energy/standby',
        headers: auth(ops),
      });
      expect(report.statusCode).toBe(200);
      expect(report.json().items).toHaveLength(1);
      expect(report.json().items[0]).toMatchObject({
        code: 'PLUG-1.1-MON',
        nightsFlagged: 7,
        kwhPerYear: 17.8,
        acknowledged: false,
      });
      expect(report.json().totalKwhPerYear).toBe(17.8);
      const ack = await t.fastify.inject({
        method: 'POST',
        url: `/energy/standby/${monitorAssetId}/ack`,
        headers: auth(ops),
        payload: { acknowledged: true, note: 'Docking hub, needed overnight' },
      });
      expect(ack.statusCode).toBe(200);
      expect(ack.json().items[0]).toMatchObject({ acknowledged: true, acknowledgedBy: 'ops' });
      expect(ack.json().totalKwhPerYear).toBe(0);
      const viewer = await login(t, 'alpha.localhost', 'viewer@alpha.demo');
      expect(
        (
          await t.fastify.inject({
            method: 'POST',
            url: `/energy/standby/${monitorAssetId}/ack`,
            headers: auth(viewer),
            payload: { acknowledged: false },
          })
        ).statusCode,
      ).toBe(403);
    });

    it('fleet, utilisation, calendar and the financial reports answer from the register and statistics', async () => {
      const fleet = await t.fastify.inject({
        method: 'GET',
        url: '/assets/fleet',
        headers: auth(ops),
      });
      expect(fleet.statusCode).toBe(200);
      expect(fleet.json()).toMatchObject({ total: 1, online: 0, reclaim: 1, warrantyExpiring: 1 });
      expect(fleet.json().items[0]).toMatchObject({
        code: 'LAPTOP-E001',
        custodian: 'Amira Haddad',
        department: 'Sales',
      });
      expect(fleet.json().items[0].flags).toEqual(
        expect.arrayContaining(['reclaim', 'warranty_expiring']),
      );

      const util = await t.fastify.inject({
        method: 'GET',
        url: '/rooms/utilisation?weeks=12',
        headers: auth(ops),
      });
      expect(util.statusCode).toBe(200);
      const room = util.json().rooms[0];
      expect(room.code).toBe('1.1');
      expect(room.heatmap).toHaveLength(7);
      expect(room.heatmap[1][9]).toBe(1); // Monday 09:00 fully occupied
      expect(room.utilisation).toBeGreaterThan(0);

      const cal = await t.fastify.inject({ method: 'GET', url: '/calendar', headers: auth(ops) });
      expect(cal.statusCode).toBe(200);
      const kinds = cal
        .json()
        .items.map((i: { kind: string; code: string | null }) => `${i.kind}:${i.code}`);
      expect(kinds).toContain('warranty_end:LAPTOP-E001');
      expect(kinds).toContain('warranty_end:AC-1.1');

      const finance = await login(t, 'alpha.localhost', 'finance@alpha.demo');
      const fin = await t.fastify.inject({
        method: 'GET',
        url: '/reports/asset-financials',
        headers: auth(finance),
      });
      expect(fin.statusCode).toBe(200);
      expect(fin.json().totals.assets).toBe(3);
      expect(fin.json().totals.purchaseCost).toBe(7645);
      expect(fin.json().categories.map((c: { category: string }) => c.category)).toEqual([
        'IT equipment',
        'HVAC',
        'Metering',
      ]);
      const cost = await t.fastify.inject({
        method: 'GET',
        url: '/reports/energy-cost?months=3',
        headers: auth(finance),
      });
      expect(cost.statusCode).toBe(200);
      expect(cost.json().months).toHaveLength(3);
      const sept = cost.json().totals.find((m: { month: string }) => m.month === '2026-09');
      expect(sept.kwh).toBe(9);
      const savings = await t.fastify.inject({
        method: 'GET',
        url: '/reports/savings',
        headers: auth(finance),
      });
      expect(savings.statusCode).toBe(200);
      expect(
        (await t.fastify.inject({ method: 'GET', url: '/assets', headers: auth(finance) }))
          .statusCode,
      ).toBe(403);
      const snap = await t.fastify.inject({
        method: 'POST',
        url: '/reports/asset-financials/run',
        headers: auth(ops),
        payload: { period: '2026-08' },
      });
      expect(snap.statusCode).toBe(200);
      expect(snap.json()).toMatchObject({ kind: 'asset-financials', period: '2026-08' });
      expect(
        (
          await t.fastify.inject({
            method: 'POST',
            url: '/reports/savings/run',
            headers: auth(finance),
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
    });
  },
);
