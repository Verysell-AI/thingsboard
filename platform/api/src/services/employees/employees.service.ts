import { randomBytes } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { laptopCodeFor } from '@platform/shared/dataset';
import type { CreateEmployee, CreateEmployeeResponse, Employee } from '@platform/shared/dto';
import type { Db, DbTx } from '../../db/index.js';
import {
  assets,
  employees,
  locations,
  type DeskGeometry,
  type EmployeeRow,
  type LocationRow,
} from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { laptopAttributes, purchaseData, userNameFor } from '../assets/asset-catalogue.js';
import { toAssetDto } from '../assets/assets.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ClockService } from '../clock/clock.service.js';
import type { TbClient, TbId } from '../tb/tb.client.js';

export interface EmployeeTenant {
  id: string;
  key: string;
  demoMode: boolean;
}

/** The two external systems the new-employee flow touches, narrowed so tests can fake them. */
export interface LaptopRegistrar {
  forTenant(
    tenantKey: string,
  ): Pick<TbClient, 'saveDevice' | 'saveServerAttributes' | 'saveRelation' | 'deleteDevice'>;
}

export interface SimulatorRegistrar {
  addDevice(input: {
    tenant: string;
    code: string;
    type: string;
    accessToken: string;
    attrs: Record<string, string | number | boolean>;
  }): Promise<void>;
}

function toEmployeeDto(
  row: EmployeeRow,
  deskRoom: Pick<LocationRow, 'id' | 'code' | 'name'> | null,
  laptop: { id: string; code: string } | null,
): Employee {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    department: row.department,
    deskRoom: deskRoom ? { id: deskRoom.id, code: deskRoom.code, name: deskRoom.name } : null,
    deskCode: row.deskCode,
    zone: row.zone,
    persona: row.persona,
    email: row.email,
    laptop: laptop ? { assetId: laptop.id, code: laptop.code } : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Next free employee code: E + zero-padded number after the highest existing one. */
export function nextEmployeeCode(existing: string[]): string {
  let max = 0;
  for (const code of existing) {
    const m = /^E(\d+)$/.exec(code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `E${String(max + 1).padStart(3, '0')}`;
}

export class EmployeesService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly tb: LaptopRegistrar,
    private readonly simulator: SimulatorRegistrar,
    private readonly tenantDomain: string,
  ) {}

  private async withRefs(tx: DbTx, rows: EmployeeRow[]): Promise<Employee[]> {
    const roomIds = [...new Set(rows.map((r) => r.deskRoomId).filter((x): x is string => !!x))];
    const rooms = roomIds.length ? await tx.select().from(locations) : [];
    const laptops = await tx
      .select({ id: assets.id, code: assets.code, custodian: assets.custodianEmployeeId })
      .from(assets)
      .where(eq(assets.class, 'laptop'));
    return rows.map((r) =>
      toEmployeeDto(
        r,
        rooms.find((l) => l.id === r.deskRoomId) ?? null,
        laptops.find((l) => l.custodian === r.id) ?? null,
      ),
    );
  }

  async list(tenantId: string): Promise<Employee[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(employees).orderBy(asc(employees.code));
      return this.withRefs(tx, rows);
    });
  }

  async byId(tenantId: string, id: string): Promise<Employee> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(employees).where(eq(employees.id, id)).limit(1);
      if (!rows[0]) throw notFound('Employee not found');
      return (await this.withRefs(tx, rows))[0]!;
    });
  }

  /**
   * HR adds a person: employee row, desk, laptop asset, ThingsBoard device (and the simulated
   * laptop in demo mode) in one operation. If anything fails after the device exists, the device
   * is deleted and the rows roll back.
   */
  async create(tenant: EmployeeTenant, input: CreateEmployee): Promise<CreateEmployeeResponse> {
    const now = await this.clock.now(tenant.key);
    const tb = this.tb.forTenant(tenant.key);
    let tbDeviceId: string | null = null;
    try {
      return await withTenant(this.db, tenant.id, async (tx) => {
        const room = (
          await tx.select().from(locations).where(eq(locations.id, input.deskRoomId)).limit(1)
        )[0];
        if (!room || room.type !== 'ROOM') throw notFound('Desk room not found');
        const desks: DeskGeometry[] = room.geometry?.desks ?? [];
        // a desk is taken when the geometry says so or an employee already sits there
        const seated = await tx
          .select({ deskCode: employees.deskCode })
          .from(employees)
          .where(eq(employees.deskRoomId, room.id));
        const taken = new Set(seated.map((e) => e.deskCode).filter(Boolean));
        const isFree = (d: DeskGeometry) => !d.employeeId && !taken.has(d.code);
        let desk: DeskGeometry | undefined;
        if (input.deskCode) {
          desk = desks.find((d) => d.code === input.deskCode);
          if (!desk) throw badRequest(`Desk ${input.deskCode} is not in ${room.code}`);
          if (!isFree(desk)) throw conflict(`Desk ${input.deskCode} is taken`);
        } else {
          desk = desks.find(isFree);
          // a full open plan gets a new desk appended to its grid rather than refusing the hire
          if (!desk && desks.length) {
            desk = nextDeskSlot(room, desks);
            desks.push(desk);
          }
        }

        const existingCodes = await tx.select({ code: employees.code }).from(employees);
        const code = nextEmployeeCode(existingCodes.map((r) => r.code));
        const email = (
          input.email ?? `${userNameFor(input.name)}@${tenant.key}.${this.tenantDomain}`
        ).toLowerCase();
        const dup = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(eq(employees.email, email))
          .limit(1);
        if (dup[0]) throw conflict(`An employee with email ${email} exists`);

        const [employee] = await tx
          .insert(employees)
          .values({
            tenantId: tenant.id,
            code,
            name: input.name.trim(),
            department: input.department,
            deskRoomId: room.id,
            deskCode: desk?.code ?? null,
            zone: desk?.zone ?? room.zone,
            persona: tenant.demoMode ? (input.persona ?? 'standard') : null,
            email,
          })
          .returning();
        if (desk) {
          const updatedDesks = desks.map((d) =>
            d.code === desk!.code ? { ...d, employeeId: employee!.id } : d,
          );
          await tx
            .update(locations)
            .set({ geometry: { ...room.geometry, desks: updatedDesks }, updatedAt: new Date() })
            .where(eq(locations.id, room.id));
        }
        await this.audit.record(tx, {
          action: 'employee.create',
          entityType: 'employee',
          entityId: employee!.id,
          after: { code, name: employee!.name, department: input.department, desk: desk?.code },
        });

        // The device is created inside the transaction so a failure below can undo it.
        const laptopCode = laptopCodeFor(code);
        const accessToken = randomBytes(12).toString('hex');
        const device = await tb.saveDevice(
          { name: laptopCode, type: 'laptop', label: `Laptop of ${employee!.name}` },
          accessToken,
        );
        tbDeviceId = device.id!.id;
        await tb.saveServerAttributes(
          'DEVICE',
          tbDeviceId,
          laptopAttributes({
            employeeId: employee!.id,
            employeeCode: code,
            room: room.code,
            zone: desk?.zone ?? room.zone,
          }),
        );
        if (room.tbAssetId) {
          const roomRef: TbId = { id: room.tbAssetId, entityType: 'ASSET' };
          await tb.saveRelation(roomRef, { id: tbDeviceId, entityType: 'DEVICE' });
        }

        const [asset] = await tx
          .insert(assets)
          .values({
            tenantId: tenant.id,
            code: laptopCode,
            name: `Laptop ${code}`,
            class: 'laptop',
            type: 'laptop',
            locationId: room.id,
            custodianEmployeeId: employee!.id,
            status: 'ACTIVE',
            tbDeviceId,
            deviceType: 'laptop',
            meta: {
              accessToken,
              desk: desk?.code ?? null,
              x: desk?.x ?? null,
              y: desk?.y ?? null,
              persona: employee!.persona,
            },
            ...purchaseData(laptopCode, 'laptop', now),
          })
          .returning();
        await this.audit.record(tx, {
          action: 'asset.create',
          entityType: 'asset',
          entityId: asset!.id,
          after: { code: laptopCode, class: 'laptop', custodian: employee!.name },
        });
        await this.audit.record(tx, {
          action: 'asset.custody',
          entityType: 'asset',
          entityId: asset!.id,
          before: null,
          after: { id: employee!.id, name: employee!.name },
        });

        let simulated = false;
        if (tenant.demoMode) {
          await this.simulator.addDevice({
            tenant: tenant.key,
            code: laptopCode,
            type: 'laptop',
            accessToken,
            attrs: {
              room: room.code,
              zone: desk?.zone ?? room.zone ?? '',
              employee_id: code,
              user: userNameFor(employee!.name),
              name: `Laptop ${employee!.name}`,
              persona: employee!.persona ?? 'standard',
            },
          });
          simulated = true;
        }

        return {
          employee: toEmployeeDto(employee!, room, { id: asset!.id, code: laptopCode }),
          asset: toAssetDto(asset!, room, { ...employee!, id: employee!.id }, null, now),
          simulated,
        };
      });
    } catch (err) {
      if (tbDeviceId) await tb.deleteDevice(tbDeviceId).catch(() => undefined);
      throw err;
    }
  }
}

const DESK_STEP_X = 100;
const DESK_STEP_Y = 60;
const DESK_MARGIN = 40;

/**
 * Position for one more desk in an open-plan room: continues the last row, wraps to a new row
 * when the room's right edge is reached, and takes the zone of the room half it lands in.
 */
export function nextDeskSlot(room: LocationRow, desks: DeskGeometry[]): DeskGeometry {
  const g = room.geometry ?? {};
  const left = (g.x ?? 0) + DESK_MARGIN;
  const right = (g.x ?? 0) + (g.w ?? 1000) - DESK_MARGIN;
  const last = desks[desks.length - 1]!;
  let x = last.x + DESK_STEP_X;
  let y = last.y;
  if (x > right) {
    x = left;
    y = last.y + DESK_STEP_Y;
  }
  const centre = (g.x ?? 0) + (g.w ?? 1000) / 2;
  const westZone = desks.find((d) => d.x < centre)?.zone ?? last.zone;
  const eastZone = desks.find((d) => d.x >= centre)?.zone ?? last.zone;
  const n = desks.length + 1;
  return {
    code: `D-${room.code}-${String(n).padStart(2, '0')}`,
    zone: x < centre ? westZone : eastZone,
    x,
    y,
    employeeId: null,
  };
}
