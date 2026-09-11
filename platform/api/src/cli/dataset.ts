import { and, eq, inArray, like } from 'drizzle-orm';
import { LAPTOP_INACTIVITY_TIMEOUT_MS } from '@platform/shared/contracts';
import { datasetAccessToken, laptopCodeFor } from '@platform/shared/dataset';
import type { Role } from '@platform/shared/roles';
import type { Container } from '../container.js';
import {
  assets,
  automations,
  bookings,
  commands,
  employees,
  locations,
  tenants,
  users,
  type DeskGeometry,
  type LocationGeometry,
  type TenantRow,
} from '../db/schema/index.js';
import { withTenant, withoutTenant } from '../db/tenant.js';
import { runWithContext } from '../lib/context.js';
import type { TbClient, TbId } from '../services/tb/tb.client.js';
import { deviceAttributes, purchaseData } from '../services/assets/asset-catalogue.js';
import { generateBookingCalendar } from './dataset-bookings.js';
import { loadDataset, pMap, type LoadedDataset } from './dataset-files.js';

export interface DatasetOptions {
  tenant: string;
  dataset: string;
  reset?: boolean;
  log?: (msg: string) => void;
}

export interface DatasetResult {
  locations: number;
  devices: number;
  laptops: number;
  employees: number;
  users: number;
  automations: number;
  bookings: number;
  elapsedMs: number;
}

/** Default automation parameters (context §9); enabled only for tenants in demo mode. */
export const DEFAULT_AUTOMATIONS: Record<string, Record<string, unknown>> = {
  room_auto_off: { idleMinutes: 15 },
  ghost_booking: { graceMinutes: 10 },
  precool: { leadMinutes: 30 },
  evening_sweep: { time: '20:00', graceMinutes: 15 },
  peak_shedding: {
    thresholdKw: 150,
    window: '12:00-14:00',
    order: ['unoccupied_rooms', 'pantry', 'open_plan_ac_setpoint+2'],
  },
  holiday_mode: { dates: [] },
};

/**
 * Demo users. `employee` links the account to a person in the dataset so person-directed
 * notifications (the late-worker "Still working / Leaving now") reach a phone someone can sign
 * in on: the operations manager is the late worker, the field operator an early bird.
 */
export const DATASET_USERS: {
  local: string;
  role: Role;
  displayName: string;
  employee?: { code: string } | { persona: string };
}[] = [
  { local: 'admin', role: 'TENANT_ADMIN', displayName: 'Tenant Admin', employee: { code: 'E001' } },
  {
    local: 'ops',
    role: 'OPS_MANAGER',
    displayName: 'Operations Manager',
    employee: { persona: 'late_worker' },
  },
  {
    local: 'field',
    role: 'FIELD_OPERATOR',
    displayName: 'Field Operator',
    employee: { persona: 'early_bird' },
  },
  { local: 'finance', role: 'FINANCE', displayName: 'Finance' },
  { local: 'viewer', role: 'VIEWER', displayName: 'Viewer' },
];

/** Employee code a demo user is linked to: an explicit code, or the first person with the persona. */
export function employeeCodeForUser(
  user: (typeof DATASET_USERS)[number],
  employees: { code: string; persona?: string | null }[],
): string | null {
  const link = user.employee;
  if (!link) return null;
  if ('code' in link) return employees.some((e) => e.code === link.code) ? link.code : null;
  return (
    [...employees]
      .filter((e) => e.persona === link.persona)
      .sort((a, b) => a.code.localeCompare(b.code))[0]?.code ?? null
  );
}

const ASSET = (id: string): TbId => ({ id, entityType: 'ASSET' });
const DEVICE = (id: string): TbId => ({ id, entityType: 'DEVICE' });

async function ensureTbAsset(
  tb: TbClient,
  name: string,
  type: string,
  label: string,
): Promise<string> {
  const existing = await tb.getTenantAssetByName(name);
  if (existing?.id) return existing.id.id;
  const saved = await tb.saveAsset({ name, type, label });
  return saved.id!.id;
}

async function ensureTbDevice(
  tb: TbClient,
  name: string,
  type: string,
  label: string,
  token: string,
): Promise<string> {
  const existing = await tb.getTenantDeviceByName(name);
  if (existing?.id) return existing.id.id;
  const saved = await tb.saveDevice({ name, type, label }, token);
  return saved.id!.id;
}

async function resetTenant(
  container: Container,
  tenant: TenantRow,
  tb: TbClient,
  ds: LoadedDataset,
  log: (m: string) => void,
): Promise<void> {
  const deviceNames = [
    ...ds.world.devices.map((d) => d.code),
    ...ds.tenant.employees.map((e) => laptopCodeFor(e.code)),
  ];
  await pMap(deviceNames, 4, async (name) => {
    const dev = await tb.getTenantDeviceByName(name);
    if (dev?.id) await tb.deleteDevice(dev.id.id);
  });
  const assetNames = [
    ...ds.world.rooms.map((r) => r.code),
    ...ds.world.zones.map((z) => z.code),
    ...ds.world.floors.map((f) => f.code),
    ds.world.building.code,
    ds.world.site.code,
  ];
  for (const name of assetNames) {
    const asset = await tb.getTenantAssetByName(name);
    if (asset?.id) await tb.deleteAsset(asset.id.id);
  }
  const domainSuffix = `@${tenant.key}.${container.config.TENANT_DOMAIN}`;
  await withTenant(container.db.app, tenant.id, async (tx) => {
    await tx.delete(commands);
    await tx.delete(bookings);
    await tx.delete(assets);
    await tx.delete(users).where(like(users.email, `%${domainSuffix}`));
    await tx.delete(employees);
    await tx.delete(locations);
    await tx.delete(automations);
    await container.audit.record(tx, {
      tenantId: tenant.id,
      action: 'dataset.reset',
      entityType: 'tenant',
      entityId: tenant.id,
      after: { dataset: ds.name },
    });
  });
  log('previous dataset removed');
}

/**
 * Loads a dataset into a provisioned tenant: ThingsBoard assets and devices with relations and
 * attributes, and the matching platform rows (locations, assets, employees, users, automations).
 */
export async function loadDatasetIntoTenant(
  container: Container,
  opts: DatasetOptions,
): Promise<DatasetResult> {
  const started = Date.now();
  const log = opts.log ?? (() => undefined);
  const { config } = container;
  const ds = await loadDataset(
    config.DATASETS_DIR,
    opts.dataset,
    opts.tenant,
    config.PLATFORM_HOST,
  );
  const { world } = ds;

  const tenant = await withoutTenant(
    container.db.admin,
    async (tx) =>
      (await tx.select().from(tenants).where(eq(tenants.key, opts.tenant)).limit(1))[0] ?? null,
  );
  if (!tenant) throw new Error(`tenant ${opts.tenant} is not provisioned; run provision first`);
  const tb = container.tb.forTenant(tenant.key);

  return runWithContext(
    { requestId: 'system', tenantId: tenant.id, tenantKey: tenant.key },
    async () => {
      if (opts.reset) await resetTenant(container, tenant, tb, ds, log);

      // ---- locations in ThingsBoard ------------------------------------------------------------
      const siteId = await ensureTbAsset(tb, world.site.code, 'Site', world.site.name);
      const buildingId = await ensureTbAsset(
        tb,
        world.building.code,
        'Building',
        world.building.name,
      );
      await tb.saveRelation(ASSET(siteId), ASSET(buildingId));
      const floorTbIds = new Map<number, string>();
      for (const f of world.floors) {
        const id = await ensureTbAsset(tb, f.code, 'Floor', f.name);
        await tb.saveRelation(ASSET(buildingId), ASSET(id));
        await tb.saveServerAttributes('ASSET', id, { floor: f.number });
        floorTbIds.set(f.number, id);
      }
      const zoneTbIds = new Map<string, string>();
      for (const z of world.zones) {
        const id = await ensureTbAsset(tb, z.code, 'Zone', z.name);
        await tb.saveRelation(ASSET(floorTbIds.get(z.floor)!), ASSET(id));
        await tb.saveServerAttributes('ASSET', id, { floor: z.floor, access_point: z.accessPoint });
        zoneTbIds.set(z.code, id);
      }
      const roomTbIds = new Map<string, string>();
      await pMap(world.rooms, 4, async (r) => {
        const id = await ensureTbAsset(tb, r.code, 'Room', r.name);
        await tb.saveRelation(ASSET(floorTbIds.get(r.floor)!), ASSET(id));
        await tb.saveServerAttributes('ASSET', id, {
          floor: r.floor,
          zone: r.zone,
          kind: r.kind,
          critical: r.critical,
          capacity: r.capacity ?? 0,
        });
        roomTbIds.set(r.code, id);
      });
      log(
        `ThingsBoard assets ready (${1 + 1 + world.floors.length + world.zones.length + world.rooms.length})`,
      );

      // ---- locations in the platform database --------------------------------------------------
      const roomByCode = new Map(world.rooms.map((r) => [r.code, r]));
      const locationIds = await withTenant(container.db.app, tenant.id, async (tx) => {
        const ids = new Map<string, string>();
        const upsert = async (row: typeof locations.$inferInsert): Promise<string> => {
          const existing = (
            await tx
              .select({ id: locations.id })
              .from(locations)
              .where(eq(locations.code, row.code))
              .limit(1)
          )[0];
          if (existing) {
            await tx
              .update(locations)
              .set({ ...row, updatedAt: new Date() })
              .where(eq(locations.id, existing.id));
            return existing.id;
          }
          const [inserted] = await tx.insert(locations).values(row).returning({ id: locations.id });
          return inserted!.id;
        };
        const site = await upsert({
          tenantId: tenant.id,
          type: 'SITE',
          code: world.site.code,
          name: world.site.name,
          tbAssetId: siteId,
        });
        ids.set(world.site.code, site);
        const building = await upsert({
          tenantId: tenant.id,
          type: 'BUILDING',
          code: world.building.code,
          name: world.building.name,
          parentId: site,
          tbAssetId: buildingId,
        });
        ids.set(world.building.code, building);
        for (const f of world.floors) {
          const id = await upsert({
            tenantId: tenant.id,
            type: 'FLOOR',
            code: f.code,
            name: f.name,
            parentId: building,
            floor: f.number,
            tbAssetId: floorTbIds.get(f.number)!,
          });
          ids.set(f.code, id);
        }
        for (const z of world.zones) {
          const geometry: LocationGeometry = { accessPoint: z.accessPoint };
          const id = await upsert({
            tenantId: tenant.id,
            type: 'ZONE',
            code: z.code,
            name: z.name,
            parentId: ids.get(world.floors.find((f) => f.number === z.floor)!.code)!,
            floor: z.floor,
            zone: z.code,
            geometry,
            tbAssetId: zoneTbIds.get(z.code)!,
          });
          ids.set(z.code, id);
        }
        for (const r of world.rooms) {
          const desks: DeskGeometry[] = world.desks
            .filter((d) => d.room === r.code)
            .map((d) => ({ code: d.code, zone: d.zone, x: d.x, y: d.y, employeeId: null }));
          const geometry: LocationGeometry = { ...r.geometry, ...(desks.length ? { desks } : {}) };
          const id = await upsert({
            tenantId: tenant.id,
            type: 'ROOM',
            code: r.code,
            name: r.name,
            parentId: ids.get(world.floors.find((f) => f.number === r.floor)!.code)!,
            floor: r.floor,
            zone: r.zone,
            kind: r.kind,
            capacity: r.capacity ?? null,
            critical: r.critical,
            geometry,
            tbAssetId: roomTbIds.get(r.code)!,
          });
          ids.set(r.code, id);
        }
        await container.audit.record(tx, {
          tenantId: tenant.id,
          action: 'dataset.locations',
          entityType: 'tenant',
          entityId: tenant.id,
          after: { count: ids.size },
        });
        return ids;
      });
      log(`platform locations ready (${locationIds.size})`);

      // ---- devices -------------------------------------------------------------------------------
      const created = await pMap(world.devices, 4, async (device) => {
        const room = 'room' in device ? roomByCode.get(device.room) : undefined;
        const token = datasetAccessToken(tenant.key, device.code);
        const tbDeviceId = await ensureTbDevice(tb, device.code, device.type, device.name, token);
        await tb.saveServerAttributes('DEVICE', tbDeviceId, deviceAttributes(device, room));
        const parentTbId = room
          ? roomTbIds.get(room.code)!
          : floorTbIds.get((device as { floor: number }).floor)!;
        await tb.saveRelation(ASSET(parentTbId), DEVICE(tbDeviceId));
        return { device, room, tbDeviceId, token };
      });
      await withTenant(container.db.app, tenant.id, async (tx) => {
        for (const { device, room, tbDeviceId, token } of created) {
          const locationCode = room
            ? room.code
            : world.floors.find((f) => f.number === (device as { floor: number }).floor)!.code;
          const meta: Record<string, unknown> = {
            accessToken: token,
            x: device.x ?? null,
            y: device.y ?? null,
            ...device.attrs,
          };
          if ('nominalPowerW' in device) meta.nominalPowerW = device.nominalPowerW;
          if (device.type === 'ac') meta.nominalCurrentA = device.nominalCurrentA;
          if (device.type === 'plug')
            Object.assign(meta, {
              appliance: device.appliance,
              sweepable: device.sweepable,
              standbyPowerW: device.standbyPowerW,
            });
          if (device.type === 'room_meter') meta.nightBaselineW = device.nightBaselineW;
          if (device.type === 'floor_meter') meta.coreLoadW = device.coreLoadW;
          const row = {
            tenantId: tenant.id,
            code: device.code,
            name: device.name,
            class: 'device',
            type: device.type === 'plug' ? device.appliance : device.type,
            locationId: locationIds.get(locationCode)!,
            status: 'ACTIVE' as const,
            tbDeviceId,
            deviceType: device.type,
            meta,
            ...purchaseData(device.code, device.type),
            updatedAt: new Date(),
          };
          const existing = (
            await tx
              .select({ id: assets.id })
              .from(assets)
              .where(eq(assets.code, device.code))
              .limit(1)
          )[0];
          if (existing) await tx.update(assets).set(row).where(eq(assets.id, existing.id));
          else await tx.insert(assets).values(row);
        }
        await container.audit.record(tx, {
          tenantId: tenant.id,
          action: 'dataset.devices',
          entityType: 'tenant',
          entityId: tenant.id,
          after: { count: created.length },
        });
      });
      log(`devices ready (${created.length})`);

      // ---- employees and laptops ---------------------------------------------------------------
      const deskByCode = new Map(world.desks.map((d) => [d.code, d]));
      const employeeIds = await withTenant(container.db.app, tenant.id, async (tx) => {
        const ids = new Map<string, string>();
        for (const e of ds.tenant.employees) {
          const desk = deskByCode.get(e.desk);
          const row = {
            tenantId: tenant.id,
            code: e.code,
            name: e.name,
            department: e.department,
            deskRoomId: locationIds.get(e.deskRoom) ?? null,
            deskCode: e.desk,
            zone: desk?.zone ?? null,
            persona: e.persona,
            email: e.email.toLowerCase(),
            updatedAt: new Date(),
          };
          const existing = (
            await tx
              .select({ id: employees.id })
              .from(employees)
              .where(eq(employees.code, e.code))
              .limit(1)
          )[0];
          if (existing) {
            await tx.update(employees).set(row).where(eq(employees.id, existing.id));
            ids.set(e.code, existing.id);
          } else {
            const [inserted] = await tx
              .insert(employees)
              .values(row)
              .returning({ id: employees.id });
            ids.set(e.code, inserted!.id);
          }
        }
        // desks in the open-plan geometry point at their employee
        for (const r of world.rooms) {
          const desks = world.desks.filter((d) => d.room === r.code);
          if (!desks.length) continue;
          const withEmployees: DeskGeometry[] = desks.map((d) => ({
            code: d.code,
            zone: d.zone,
            x: d.x,
            y: d.y,
            employeeId: ds.tenant.employees.find((e) => e.desk === d.code)?.code
              ? (ids.get(ds.tenant.employees.find((e) => e.desk === d.code)!.code) ?? null)
              : null,
          }));
          await tx
            .update(locations)
            .set({ geometry: { ...r.geometry, desks: withEmployees } })
            .where(eq(locations.code, r.code));
        }
        await container.audit.record(tx, {
          tenantId: tenant.id,
          action: 'dataset.employees',
          entityType: 'tenant',
          entityId: tenant.id,
          after: { count: ids.size },
        });
        return ids;
      });

      const laptops = await pMap(ds.tenant.employees, 4, async (e) => {
        const code = laptopCodeFor(e.code);
        const desk = deskByCode.get(e.desk);
        const token = datasetAccessToken(tenant.key, code);
        const tbDeviceId = await ensureTbDevice(tb, code, 'laptop', `Laptop of ${e.name}`, token);
        await tb.saveServerAttributes('DEVICE', tbDeviceId, {
          employee_id: employeeIds.get(e.code)!,
          employee_code: e.code,
          inactivityTimeout: LAPTOP_INACTIVITY_TIMEOUT_MS,
          room: e.deskRoom,
          zone: desk?.zone ?? '',
        });
        await tb.saveRelation(ASSET(roomTbIds.get(e.deskRoom)!), DEVICE(tbDeviceId));
        return { e, code, tbDeviceId, token };
      });
      await withTenant(container.db.app, tenant.id, async (tx) => {
        for (const { e, code, tbDeviceId, token } of laptops) {
          const desk = deskByCode.get(e.desk);
          const row = {
            tenantId: tenant.id,
            code,
            name: `Laptop ${e.code}`,
            class: 'laptop',
            type: 'laptop',
            locationId: locationIds.get(e.deskRoom) ?? null,
            custodianEmployeeId: employeeIds.get(e.code) ?? null,
            status: 'ACTIVE' as const,
            tbDeviceId,
            deviceType: 'laptop',
            meta: {
              accessToken: token,
              desk: e.desk,
              x: desk?.x ?? null,
              y: desk?.y ?? null,
              persona: e.persona,
            },
            ...purchaseData(code, 'laptop'),
            updatedAt: new Date(),
          };
          const existing = (
            await tx.select({ id: assets.id }).from(assets).where(eq(assets.code, code)).limit(1)
          )[0];
          if (existing) await tx.update(assets).set(row).where(eq(assets.id, existing.id));
          else await tx.insert(assets).values(row);
        }
        await container.audit.record(tx, {
          tenantId: tenant.id,
          action: 'dataset.laptops',
          entityType: 'tenant',
          entityId: tenant.id,
          after: { count: laptops.length },
        });
      });
      log(`employees and laptops ready (${laptops.length})`);

      // ---- users and automations ----------------------------------------------------------------
      const userCount = await withTenant(container.db.app, tenant.id, async (tx) => {
        for (const u of DATASET_USERS) {
          const employeeCode = employeeCodeForUser(u, ds.tenant.employees);
          await container.users.upsertInTx(tx, tenant.id, {
            email: `${u.local}@${tenant.key}.${config.TENANT_DOMAIN}`,
            password: config.DATASET_USER_PASSWORD,
            role: u.role,
            displayName: u.displayName,
            employeeId: employeeCode ? (employeeIds.get(employeeCode) ?? null) : null,
          });
        }
        return DATASET_USERS.length;
      });

      const automationCount = await withTenant(container.db.app, tenant.id, async (tx) => {
        const keys = Object.keys(DEFAULT_AUTOMATIONS);
        const existing = await tx
          .select({ key: automations.key })
          .from(automations)
          .where(inArray(automations.key, keys));
        const present = new Set(existing.map((a) => a.key));
        for (const key of keys) {
          if (present.has(key)) {
            await tx
              .update(automations)
              .set({ enabled: tenant.demoMode, updatedAt: new Date() })
              .where(and(eq(automations.key, key), eq(automations.tenantId, tenant.id)));
          } else {
            await tx.insert(automations).values({
              tenantId: tenant.id,
              key,
              enabled: tenant.demoMode,
              params: DEFAULT_AUTOMATIONS[key]!,
            });
          }
        }
        await container.audit.record(tx, {
          tenantId: tenant.id,
          action: 'dataset.automations',
          entityType: 'tenant',
          entityId: tenant.id,
          after: { keys, enabled: tenant.demoMode },
        });
        return keys.length;
      });
      log(`users (${userCount}) and automations (${automationCount}) ready`);

      // ---- bookings: a realistic two-week meeting calendar ---------------------------------------
      const now = await container.clock.now(tenant.key);
      const calendar = generateBookingCalendar({
        tenantKey: tenant.key,
        rooms: world.rooms,
        employees: ds.tenant.employees,
        now,
        timeZone: config.TIME_ZONE,
      });
      const bookingCount = await withTenant(container.db.app, tenant.id, async (tx) => {
        await tx.delete(bookings).where(inArray(bookings.title, calendar.titles));
        const rows = calendar.bookings
          .map((b) => ({
            tenantId: tenant.id,
            roomId: locationIds.get(b.roomCode),
            start: new Date(b.start),
            end: new Date(b.end),
            organiserId: employeeIds.get(b.organiserCode) ?? null,
            title: b.title,
            attendance: b.attendance,
            status: 'ACTIVE' as const,
          }))
          .filter((r): r is typeof r & { roomId: string } => !!r.roomId);
        for (let i = 0; i < rows.length; i += 200)
          await tx.insert(bookings).values(rows.slice(i, i + 200));
        await container.audit.record(tx, {
          tenantId: tenant.id,
          action: 'dataset.bookings',
          entityType: 'tenant',
          entityId: tenant.id,
          after: { count: rows.length, from: calendar.from, to: calendar.to },
        });
        return rows.length;
      });
      log(`bookings ready (${bookingCount})`);

      return {
        locations: locationIds.size,
        devices: created.length,
        laptops: laptops.length,
        employees: employeeIds.size,
        users: userCount,
        automations: automationCount,
        bookings: bookingCount,
        elapsedMs: Date.now() - started,
      };
    },
  );
}
