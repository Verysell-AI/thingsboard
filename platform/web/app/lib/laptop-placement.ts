import type { DeviceLiveState, FloorPlan } from '@platform/shared/dto';

type PlanDevice = FloorPlan['devices'][number];
type PlanZone = FloorPlan['zones'][number];

/** `1.West` → `AP-1W`: the dataset convention, used when the zone carries no access point. */
export function accessPointForZoneCode(code: string): string {
  const [floor, side] = code.split('.');
  return `AP-${floor ?? ''}${(side ?? '').charAt(0).toUpperCase()}`;
}

export function zoneAccessPoint(zone: PlanZone): string {
  return zone.accessPoint ?? accessPointForZoneCode(zone.code);
}

/** Default distance between laptop chips drawn inside one meeting room, in plan units. */
const DEFAULT_LAPTOP_STEP = 40;

export interface LaptopPlacement {
  x: number;
  y: number;
  /** Room the laptop is drawn in, when it is not at its desk. */
  room: string | null;
  atDesk: boolean;
}

/**
 * Where to draw a laptop: at its desk while it reports its home access point, otherwise inside the
 * first meeting room of the reported zone whose occupancy sensor sees people (fallback: the zone's
 * first meeting room, then the desk). `index` spreads several laptops inside one room, `step` units
 * apart.
 */
export function placeLaptop(
  device: PlanDevice,
  live: DeviceLiveState | undefined,
  plan: FloorPlan,
  devices: Record<string, DeviceLiveState>,
  index = 0,
  step = DEFAULT_LAPTOP_STEP,
): LaptopPlacement | null {
  if (device.x === null || device.y === null) return null;
  const desk: LaptopPlacement = { x: device.x, y: device.y, room: null, atDesk: true };
  const ap = live?.online ? live.values.ap : undefined;
  if (typeof ap !== 'string' || !ap) return desk;
  const deskDef = plan.desks.find((d) => d.x === device.x && d.y === device.y);
  const homeZone = deskDef
    ? plan.zones.find((z) => z.code === deskDef.zone)
    : plan.zones.find((z) => plan.rooms.find((r) => r.code === device.room)?.zone === z.code);
  const homeAp = homeZone ? zoneAccessPoint(homeZone) : null;
  if (!homeAp || ap === homeAp) return desk;
  const zone = plan.zones.find((z) => zoneAccessPoint(z) === ap);
  if (!zone) return desk;
  const meetingRooms = plan.rooms.filter((r) => r.zone === zone.code && r.kind === 'meeting');
  if (meetingRooms.length === 0) return desk;
  const occupied = meetingRooms.find((r) =>
    Object.values(devices).some(
      (d) =>
        d.room === r.code &&
        (d.deviceType === 'occupancy' || d.deviceCode.startsWith('OCC-')) &&
        Number(d.values.count ?? 0) > 0,
    ),
  );
  const room = occupied ?? meetingRooms[0]!;
  const g = room.geometry;
  if (!g) return desk;
  const cols = Math.max(1, Math.floor((g.w - 40) / step));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: g.x + 24 + col * step,
    y: g.y + g.h - 24 - row * step,
    room: room.code,
    atDesk: false,
  };
}
