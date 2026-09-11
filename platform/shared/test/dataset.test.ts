import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PersonasSchema,
  TenantDatasetSchema,
  WorldSchema,
  laptopCodeFor,
  zoneForAccessPoint,
} from '../src/dataset/schema.js';

const root = join(import.meta.dirname, '../../datasets/office-demo');
const load = (rel: string) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

describe('office-demo dataset', () => {
  const world = WorldSchema.parse(load('world.json'));
  const personas = PersonasSchema.parse(load('personas.json'));

  it('has two floors, two zones per floor and the rooms from the plan', () => {
    expect(world.floors).toHaveLength(2);
    expect(world.zones.map((z) => z.code).sort()).toEqual(['1.East', '1.West', '2.East', '2.West']);
    const codes = world.rooms.map((r) => r.code);
    for (const c of [
      '1.1',
      '1.2',
      '1.3',
      '1.4',
      '1.O',
      '1.P',
      '1.R',
      '2.1',
      '2.2',
      '2.3',
      '2.4',
      '2.O',
      '2.S',
    ]) {
      expect(codes).toContain(c);
    }
    expect(world.rooms.find((r) => r.code === '2.S')?.critical).toBe(true);
  });

  it('gives every room a light, an AC unit and a room meter', () => {
    for (const room of world.rooms) {
      const codes = world.devices
        .filter((d) => 'room' in d && d.room === room.code)
        .map((d) => d.type);
      expect(codes, room.code).toEqual(expect.arrayContaining(['light', 'ac', 'room_meter']));
    }
    expect(world.devices.filter((d) => d.type === 'floor_meter')).toHaveLength(2);
    expect(world.devices.filter((d) => d.type === 'occupancy')).toHaveLength(8);
  });

  it('keeps geometry inside the 1000x600 viewBox', () => {
    for (const r of world.rooms) {
      expect(r.geometry.x + r.geometry.w).toBeLessThanOrEqual(1000);
      expect(r.geometry.y + r.geometry.h).toBeLessThanOrEqual(600);
    }
    for (const d of world.desks) {
      const room = world.rooms.find((r) => r.code === d.room)!;
      expect(d.x).toBeGreaterThan(room.geometry.x);
      expect(d.x).toBeLessThan(room.geometry.x + room.geometry.w);
    }
  });

  it('marks exactly one AC unit as degrading (the filter scenario)', () => {
    const degrading = world.devices.filter((d) => d.type === 'ac' && d.filterDegrading);
    expect(degrading.map((d) => d.code)).toEqual(['AC-2.3']);
  });

  it('resolves access points to zones', () => {
    expect(zoneForAccessPoint(world, 'AP-1W')?.code).toBe('1.West');
    expect(zoneForAccessPoint(world, 'AP-9X')).toBeUndefined();
  });

  it.each(['alpha', 'beta'])(
    'tenant %s validates and references known desks and personas',
    (key) => {
      const tenant = TenantDatasetSchema.parse(load(`tenants/${key}.json`));
      expect(tenant.key).toBe(key);
      expect(tenant.employees).toHaveLength(24);
      const deskCodes = new Set(world.desks.map((d) => d.code));
      const personaKeys = new Set(personas.personas.map((p) => p.key));
      const seen = new Set<string>();
      for (const e of tenant.employees) {
        expect(deskCodes.has(e.desk), e.desk).toBe(true);
        expect(personaKeys.has(e.persona)).toBe(true);
        expect(seen.has(e.desk)).toBe(false);
        seen.add(e.desk);
        expect(laptopCodeFor(e.code)).toBe(`LAPTOP-${e.code}`);
      }
      expect(() => readFileSync(join(root, tenant.brand.logo))).not.toThrow();
    },
  );
});
