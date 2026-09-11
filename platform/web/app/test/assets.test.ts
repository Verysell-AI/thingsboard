import { describe, expect, it } from 'vitest';
import type { DeviceLiveState } from '@platform/shared/dto';
import { assetFiltersFrom, assetsQueryString, historyKeysFor } from '~/lib/assets';
import { deviceStatus } from '~/lib/device-icons';

const live = (values: Record<string, number>, online = true): DeviceLiveState => ({
  deviceCode: 'PLUG-1.1-PROJ',
  deviceType: 'plug',
  tbDeviceId: null,
  room: '1.1',
  online,
  ts: 1,
  values,
  activeAlarms: [],
});

describe('asset filters', () => {
  it('serialises only non-default filters and reads them back', () => {
    expect(assetsQueryString({})).toBe('');
    const qs = assetsQueryString({
      search: ' AC-1 ',
      floor: 2,
      status: 'ACTIVE',
      exceptions: true,
      sort: 'name',
      order: 'desc',
      page: 3,
      pageSize: 50,
    });
    expect(qs).toBe(
      '?search=AC-1&floor=2&status=ACTIVE&exceptions=true&sort=name&order=desc&page=3',
    );
    const back = assetFiltersFrom(new URLSearchParams(qs));
    expect(back).toMatchObject({
      search: 'AC-1',
      floor: 2,
      status: 'ACTIVE',
      exceptions: true,
      sort: 'name',
      order: 'desc',
      page: 3,
    });
  });

  it('picks chart keys per device type', () => {
    expect(historyKeysFor('laptop')).toEqual(['battery', 'cpu']);
    expect(historyKeysFor('room_meter')).toEqual(['power_w', 'energy_kwh']);
    expect(historyKeysFor(null)).toEqual(['power_w']);
  });
});

describe('projector inference', () => {
  const projector = { type: 'plug', code: 'PLUG-1.1-PROJ', appliance: 'projector' };
  it('reads "in use" from a plug above 20 W, standby below, off when the relay is open', () => {
    expect(deviceStatus(projector, live({ state: 1, power_w: 180 }))).toBe('on');
    expect(deviceStatus(projector, live({ state: 1, power_w: 3 }))).toBe('standby');
    expect(deviceStatus(projector, live({ state: 0, power_w: 0 }))).toBe('off');
    expect(deviceStatus(projector, live({ state: 1, power_w: 180 }, false))).toBe('offline');
    expect(deviceStatus(projector, undefined)).toBe('unknown');
  });
});
