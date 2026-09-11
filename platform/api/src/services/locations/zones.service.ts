import type { PersonPresence, RoomState } from '../automations/context.js';

/** Rooms of one zone (room-level zone code, e.g. `1.West`). */
export function roomsInZone(rooms: RoomState[], zone: string): RoomState[] {
  return rooms.filter((r) => r.room.zone === zone);
}

/** Online laptops grouped by the zone of the room they are in; laptops without a zone are dropped. */
export function peopleByZone(people: PersonPresence[]): Map<string, PersonPresence[]> {
  const out = new Map<string, PersonPresence[]>();
  for (const p of people) {
    if (!p.zone) continue;
    const list = out.get(p.zone) ?? [];
    list.push(p);
    out.set(p.zone, list);
  }
  return out;
}

/** Display names of the people in a list, deduplicated, laptops without an owner shown by code. */
export function names(people: PersonPresence[]): string[] {
  return [...new Set(people.map((p) => p.employeeName ?? p.laptopCode))];
}
