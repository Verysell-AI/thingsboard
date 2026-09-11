import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PersonasSchema,
  TenantDatasetSchema,
  WorldSchema,
  datasetAccessToken,
  laptopCodeFor,
  type DeviceType,
  type EmployeeSeed,
  type Persona,
  type Personas,
  type Room,
  type TenantDataset,
  type World,
  type WorldDevice,
  type Zone,
} from '@platform/shared/dataset';

/** Everything needed to instantiate one virtual device. */
export interface DeviceSpec {
  tenant: string;
  code: string;
  type: DeviceType;
  name: string;
  accessToken: string;
  /** Room code; floor meters and runtime laptops without a desk have none. */
  room: string | null;
  zone: string | null;
  floor: number | null;
  /** Dataset definition for non-laptop devices. */
  world?: WorldDevice;
  /** Laptop-only fields. */
  laptop?: {
    employeeCode: string;
    user: string;
    homeAccessPoint: string;
    persona: Persona | null;
    deskRoom: string | null;
  };
}

export interface TenantWorld {
  tenant: TenantDataset;
  world: World;
  personas: Personas;
  devices: DeviceSpec[];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Telemetry `user` value for an employee: firstname.lastname in lowercase. */
export function userNameFor(employee: EmployeeSeed): string {
  return employee.name
    .trim()
    .split(/\s+/)
    .map((part) => part.toLowerCase())
    .join('.');
}

export function roomByCode(world: World, code: string): Room | undefined {
  return world.rooms.find((r) => r.code === code);
}

export function zoneByCode(world: World, code: string): Zone | undefined {
  return world.zones.find((z) => z.code === code);
}

export function meetingRoomsOnFloor(world: World, floor: number): Room[] {
  return world.rooms.filter((r) => r.floor === floor && r.kind === 'meeting');
}

export function loadWorldFiles(
  datasetsDir: string,
  dataset: string,
): { world: World; personas: Personas } {
  const root = join(datasetsDir, dataset);
  return {
    world: WorldSchema.parse(readJson(join(root, 'world.json'))),
    personas: PersonasSchema.parse(readJson(join(root, 'personas.json'))),
  };
}

export function loadTenantDataset(
  datasetsDir: string,
  dataset: string,
  tenantKey: string,
): TenantDataset {
  const path = join(datasetsDir, dataset, 'tenants', `${tenantKey}.json`);
  const tenant = TenantDatasetSchema.parse(readJson(path));
  if (tenant.key !== tenantKey) {
    throw new Error(`tenant file ${path} declares key ${tenant.key}, expected ${tenantKey}`);
  }
  return tenant;
}

export function buildDeviceSpecs(
  tenant: TenantDataset,
  world: World,
  personas: Personas,
): DeviceSpec[] {
  const specs: DeviceSpec[] = [];
  for (const device of world.devices) {
    const room = 'room' in device ? roomByCode(world, device.room) : undefined;
    const floor = 'floor' in device ? device.floor : (room?.floor ?? null);
    specs.push({
      tenant: tenant.key,
      code: device.code,
      type: device.type,
      name: device.name,
      accessToken: datasetAccessToken(tenant.key, device.code),
      room: room?.code ?? null,
      zone: room?.zone ?? null,
      floor,
      world: device,
    });
  }
  for (const employee of tenant.employees) {
    const desk = world.desks.find((d) => d.code === employee.desk);
    const zone = desk ? zoneByCode(world, desk.zone) : undefined;
    const room = roomByCode(world, employee.deskRoom);
    if (!desk || !zone || !room) {
      throw new Error(
        `employee ${employee.code}: desk ${employee.desk} or room ${employee.deskRoom} not in world`,
      );
    }
    const persona = personas.personas.find((p) => p.key === employee.persona) ?? null;
    const code = laptopCodeFor(employee.code);
    specs.push({
      tenant: tenant.key,
      code,
      type: 'laptop',
      name: `Laptop ${employee.name}`,
      accessToken: datasetAccessToken(tenant.key, code),
      room: room.code,
      zone: zone.code,
      floor: room.floor,
      laptop: {
        employeeCode: employee.code,
        user: userNameFor(employee),
        homeAccessPoint: zone.accessPoint,
        persona,
        deskRoom: room.code,
      },
    });
  }
  return specs;
}

export function loadTenantWorld(
  datasetsDir: string,
  dataset: string,
  tenantKey: string,
): TenantWorld {
  const { world, personas } = loadWorldFiles(datasetsDir, dataset);
  const tenant = loadTenantDataset(datasetsDir, dataset, tenantKey);
  return { tenant, world, personas, devices: buildDeviceSpecs(tenant, world, personas) };
}
