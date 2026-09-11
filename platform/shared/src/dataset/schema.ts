import { z } from 'zod';

/**
 * Dataset files describe everything a tenant can be loaded with: the physical world (world.json),
 * behaviour profiles (personas.json) and per-tenant identity, brand and people (tenants/<key>.json).
 * Real tenants have no dataset; the schema exists so demo content is validated data, not code.
 */

export const DEVICE_TYPES = [
  'light',
  'ac',
  'occupancy',
  'plug',
  'room_meter',
  'floor_meter',
  'laptop',
] as const;
export const DeviceTypeSchema = z.enum(DEVICE_TYPES);
export type DeviceType = z.infer<typeof DeviceTypeSchema>;

export const ROOM_KINDS = [
  'meeting',
  'open_plan',
  'pantry',
  'reception',
  'server',
  'other',
] as const;
export const RoomKindSchema = z.enum(ROOM_KINDS);
export type RoomKind = z.infer<typeof RoomKindSchema>;

export const DEPARTMENTS = ['Finance', 'Sales', 'Engineering', 'Operations'] as const;
export const DepartmentSchema = z.enum(DEPARTMENTS);
export type Department = z.infer<typeof DepartmentSchema>;

/** Rectangle in the floor plan viewBox (0..1000 × 0..600). */
export const GeometrySchema = z.object({
  x: z.number().min(0).max(1000),
  y: z.number().min(0).max(600),
  w: z.number().positive().max(1000),
  h: z.number().positive().max(600),
});
export type Geometry = z.infer<typeof GeometrySchema>;

export const FLOOR_PLAN_VIEWBOX = { width: 1000, height: 600 } as const;

const codeSchema = z.string().min(1).max(64);
const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM')
  .nullable();

export const FloorSchema = z.object({
  number: z.number().int().min(1),
  code: codeSchema,
  name: z.string(),
});

export const ZoneSchema = z.object({
  code: codeSchema,
  name: z.string(),
  floor: z.number().int().min(1),
  /** Wi-Fi access point id reported by laptops located in this zone (for example AP-1W). */
  accessPoint: codeSchema,
});

export const RoomSchema = z.object({
  code: codeSchema,
  name: z.string(),
  floor: z.number().int().min(1),
  kind: RoomKindSchema,
  zone: codeSchema,
  capacity: z.number().int().positive().optional(),
  /** Critical rooms (server room) are never commanded by automations. */
  critical: z.boolean().default(false),
  geometry: GeometrySchema,
});

export const DeskSchema = z.object({
  code: codeSchema,
  room: codeSchema,
  zone: codeSchema,
  x: z.number().min(0).max(1000),
  y: z.number().min(0).max(600),
});

const attrValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const deviceBase = {
  code: codeSchema,
  name: z.string(),
  /** Optional position inside the room for the floor plan; defaults to the room centre. */
  x: z.number().optional(),
  y: z.number().optional(),
  /** Extra server attributes pushed to ThingsBoard verbatim. */
  attrs: z.record(z.string(), attrValueSchema).default({}),
};

export const LightDeviceSchema = z.object({
  ...deviceBase,
  type: z.literal('light'),
  room: codeSchema,
  /** Power when on, in watts. */
  nominalPowerW: z.number().positive(),
});

export const AcDeviceSchema = z.object({
  ...deviceBase,
  type: z.literal('ac'),
  room: codeSchema,
  nominalPowerW: z.number().positive(),
  nominalCurrentA: z.number().positive(),
  /** When true the unit's current slowly rises at constant output (the "filter" scenario). */
  filterDegrading: z.boolean().default(false),
});

export const OccupancyDeviceSchema = z.object({
  ...deviceBase,
  type: z.literal('occupancy'),
  room: codeSchema,
});

export const PlugDeviceSchema = z.object({
  ...deviceBase,
  type: z.literal('plug'),
  room: codeSchema,
  appliance: z.enum(['projector', 'fridge', 'coffee_machine', 'monitor', 'heater', 'other']),
  /** Power when the appliance is in use, in watts. */
  nominalPowerW: z.number().positive(),
  /** Standby power when idle, in watts. */
  standbyPowerW: z.number().min(0).default(0),
  /** Automations may switch sweepable plugs off. */
  sweepable: z.boolean().default(true),
});

export const RoomMeterDeviceSchema = z.object({
  ...deviceBase,
  type: z.literal('room_meter'),
  room: codeSchema,
  /** Expected night-time load; the night anomaly alarm fires above twice this value. */
  nightBaselineW: z.number().positive(),
});

export const FloorMeterDeviceSchema = z.object({
  ...deviceBase,
  type: z.literal('floor_meter'),
  floor: z.number().int().min(1),
  /** Load not attributed to any room (core services), in watts. */
  coreLoadW: z.number().min(0),
});

export const WorldDeviceSchema = z.discriminatedUnion('type', [
  LightDeviceSchema,
  AcDeviceSchema,
  OccupancyDeviceSchema,
  PlugDeviceSchema,
  RoomMeterDeviceSchema,
  FloorMeterDeviceSchema,
]);
export type WorldDevice = z.infer<typeof WorldDeviceSchema>;

export const WorldSchema = z
  .object({
    site: z.object({ code: codeSchema, name: z.string() }),
    building: z.object({ code: codeSchema, name: z.string() }),
    floors: z.array(FloorSchema).min(1),
    zones: z.array(ZoneSchema).min(1),
    rooms: z.array(RoomSchema).min(1),
    desks: z.array(DeskSchema),
    devices: z.array(WorldDeviceSchema),
  })
  .superRefine((world, ctx) => {
    const roomCodes = new Set(world.rooms.map((r) => r.code));
    const zoneCodes = new Set(world.zones.map((z) => z.code));
    const floorNumbers = new Set(world.floors.map((f) => f.number));
    const seenDevices = new Set<string>();
    for (const room of world.rooms) {
      if (!zoneCodes.has(room.zone)) {
        ctx.addIssue({ code: 'custom', message: `room ${room.code}: unknown zone ${room.zone}` });
      }
      if (!floorNumbers.has(room.floor)) {
        ctx.addIssue({ code: 'custom', message: `room ${room.code}: unknown floor ${room.floor}` });
      }
    }
    for (const desk of world.desks) {
      if (!roomCodes.has(desk.room)) {
        ctx.addIssue({ code: 'custom', message: `desk ${desk.code}: unknown room ${desk.room}` });
      }
      if (!zoneCodes.has(desk.zone)) {
        ctx.addIssue({ code: 'custom', message: `desk ${desk.code}: unknown zone ${desk.zone}` });
      }
    }
    for (const device of world.devices) {
      if (seenDevices.has(device.code)) {
        ctx.addIssue({ code: 'custom', message: `duplicate device code ${device.code}` });
      }
      seenDevices.add(device.code);
      if ('room' in device && !roomCodes.has(device.room)) {
        ctx.addIssue({
          code: 'custom',
          message: `device ${device.code}: unknown room ${device.room}`,
        });
      }
      if ('floor' in device && !floorNumbers.has(device.floor)) {
        ctx.addIssue({
          code: 'custom',
          message: `device ${device.code}: unknown floor ${device.floor}`,
        });
      }
    }
  });
export type World = z.infer<typeof WorldSchema>;
export type Floor = z.infer<typeof FloorSchema>;
export type Zone = z.infer<typeof ZoneSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Desk = z.infer<typeof DeskSchema>;

export const PERSONA_KEYS = [
  'early_bird',
  'standard',
  'late_worker',
  'meeting_heavy',
  'remote_today',
] as const;
export const PersonaKeySchema = z.enum(PERSONA_KEYS);
export type PersonaKey = z.infer<typeof PersonaKeySchema>;

export const PersonaSchema = z.object({
  key: PersonaKeySchema,
  name: z.string(),
  /** Local time of arrival, HH:MM, or null when the persona does not come in. */
  arrive: timeOfDaySchema,
  leave: timeOfDaySchema,
  /** Meetings attended per day. */
  meetings: z.number().int().min(0),
  notes: z.string().optional(),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const PersonasSchema = z.object({
  personas: z.array(PersonaSchema).min(1),
});
export type Personas = z.infer<typeof PersonasSchema>;

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #RRGGBB');

export const BrandSchema = z.object({
  /** Display name shown in the header and page titles. */
  name: z.string().min(1),
  shortName: z.string().min(1).max(12).optional(),
  primaryColor: hexColour,
  accentColor: hexColour,
  /** Path of an SVG relative to the dataset root, for example brands/alpha/logo.svg. */
  logo: z.string().min(1),
  /** Path of the favicon (SVG) relative to the dataset root. */
  favicon: z.string().min(1).optional(),
  fontFamily: z.string().default('Inter, system-ui, sans-serif'),
  loginTagline: z.string().optional(),
});
export type Brand = z.infer<typeof BrandSchema>;

export const EmployeeSeedSchema = z.object({
  code: codeSchema,
  name: z.string().min(1),
  department: DepartmentSchema,
  deskRoom: codeSchema,
  desk: codeSchema,
  persona: PersonaKeySchema,
  email: z.string().email(),
});
export type EmployeeSeed = z.infer<typeof EmployeeSeedSchema>;

export const LOCALES = ['en', 'ar'] as const;
export const LocaleSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof LocaleSchema>;

export const TenantDatasetSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9-]{1,30}$/, 'lowercase key')
    .describe('Stable tenant key used in hostnames, tokens and the CLI'),
  name: z.string().min(1),
  hostname: z.string().min(1),
  locale: LocaleSchema.default('en'),
  currency: z.string().length(3).default('AED'),
  tariffPerKwh: z.number().positive(),
  demoMode: z.boolean().default(true),
  brand: BrandSchema,
  employees: z.array(EmployeeSeedSchema),
});
export type TenantDataset = z.infer<typeof TenantDatasetSchema>;

/** Device code of the laptop that belongs to an employee. */
export function laptopCodeFor(employeeCode: string): string {
  return `LAPTOP-${employeeCode}`;
}

/** Reproducible ThingsBoard access token for dataset devices. */
export function datasetAccessToken(tenantKey: string, deviceCode: string): string {
  return `${tenantKey}-${deviceCode}`;
}

export function roomsInZone(world: World, zoneCode: string): Room[] {
  return world.rooms.filter((r) => r.zone === zoneCode);
}

export function zoneForAccessPoint(world: World, accessPoint: string): Zone | undefined {
  return world.zones.find((z) => z.accessPoint === accessPoint);
}
