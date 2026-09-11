import { describe, expect, it } from 'vitest';
import type { DeviceLiveState } from '@platform/shared/dto';
import { rankCulprits } from './event-hooks.js';

function device(code: string, deviceType: string, room: string, powerW?: number): DeviceLiveState {
  return {
    deviceCode: code,
    deviceType,
    tbDeviceId: null,
    room,
    online: true,
    ts: 1,
    values: powerW === undefined ? {} : { power_w: powerW },
    activeAlarms: [],
  };
}

describe('rankCulprits', () => {
  it('lists the room’s consumers by power, the heater first, without meters or sensors', () => {
    const devices = [
      device('RM-1.P', 'room_meter', '1.P', 1620),
      device('LIGHT-1.P', 'light', '1.P', 40),
      device('PLUG-1.P-COFFEE', 'plug', '1.P', 1512),
      device('PLUG-1.P-FRIDGE', 'plug', '1.P', 65),
      device('AC-1.P', 'ac', '1.P', 0),
      device('OCC-1.1', 'occupancy', '1.1'),
      device('LIGHT-1.1', 'light', '1.1', 60),
    ];
    expect(rankCulprits(devices, '1.P')).toEqual([
      { code: 'PLUG-1.P-COFFEE', deviceType: 'plug', powerW: 1512 },
      { code: 'PLUG-1.P-FRIDGE', deviceType: 'plug', powerW: 65 },
      { code: 'LIGHT-1.P', deviceType: 'light', powerW: 40 },
    ]);
    expect(rankCulprits(devices, '2.1')).toEqual([]);
  });
});
