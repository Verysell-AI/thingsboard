import { describe, expect, it } from 'vitest';
import { DATASET_USERS, employeeCodeForUser } from './dataset.js';
import type { Room, WorldDevice } from '@platform/shared/dataset';
import { deviceAttributes } from '../services/assets/asset-catalogue.js';
import { DEFAULT_AUTOMATIONS } from './dataset.js';

const room: Room = {
  code: '2.3',
  name: 'Meeting room 2.3',
  floor: 2,
  kind: 'meeting',
  zone: '2.East',
  capacity: 8,
  critical: false,
  geometry: { x: 0, y: 0, w: 10, h: 10 },
};

describe('dataset device attributes', () => {
  it('writes the alarm thresholds the device profiles compare against for AC units', () => {
    const ac: WorldDevice = {
      code: 'AC-2.3',
      name: 'AC',
      type: 'ac',
      room: '2.3',
      nominalPowerW: 1000,
      nominalCurrentA: 4.2,
      filterDegrading: true,
      attrs: {},
    };
    expect(deviceAttributes(ac, room)).toEqual({
      room: '2.3',
      zone: '2.East',
      critical: false,
      floor: 2,
      nominal_current_a: 4.2,
      ac_current_alarm_a: 5.25,
      ac_current_clear_a: 4.62,
      nominal_power_w: 1000,
    });
  });

  it('writes the night anomaly threshold for room meters and passes extra attrs through', () => {
    const meter: WorldDevice = {
      code: 'RM-2.3',
      name: 'Meter',
      type: 'room_meter',
      room: '2.3',
      nightBaselineW: 25,
      attrs: { vendor: 'x' },
    };
    expect(deviceAttributes(meter, room)).toMatchObject({
      night_baseline_w: 25,
      night_anomaly_w: 50,
      vendor: 'x',
    });
    const fm: WorldDevice = {
      code: 'FM-2',
      name: 'Floor meter',
      type: 'floor_meter',
      floor: 2,
      coreLoadW: 600,
      attrs: {},
    };
    expect(deviceAttributes(fm, undefined)).toEqual({ floor: 2 });
  });

  it('seeds the six automations from the plan with their default parameters', () => {
    expect(Object.keys(DEFAULT_AUTOMATIONS).sort()).toEqual([
      'evening_sweep',
      'ghost_booking',
      'holiday_mode',
      'peak_shedding',
      'precool',
      'room_auto_off',
    ]);
    expect(DEFAULT_AUTOMATIONS.evening_sweep).toEqual({ time: '20:00', graceMinutes: 15 });
  });
});

describe('demo users linked to people', () => {
  const employees = [
    { code: 'E001', persona: 'standard' },
    { code: 'E009', persona: 'late_worker' },
    { code: 'E021', persona: 'late_worker' },
    { code: 'E007', persona: 'early_bird' },
  ];
  const user = (local: string) => DATASET_USERS.find((u) => u.local === local)!;
  it('makes the operations manager the first late worker and leaves finance and viewers unlinked', () => {
    expect(employeeCodeForUser(user('ops'), employees)).toBe('E009');
    expect(employeeCodeForUser(user('field'), employees)).toBe('E007');
    expect(employeeCodeForUser(user('admin'), employees)).toBe('E001');
    expect(employeeCodeForUser(user('finance'), employees)).toBeNull();
    expect(employeeCodeForUser(user('viewer'), employees)).toBeNull();
    expect(employeeCodeForUser(user('admin'), [])).toBeNull();
  });
});
