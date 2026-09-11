import { describe, expect, it } from 'vitest';
import { initialLiveState, liveReducer, roomLightsOn } from '~/lib/live-store';

describe('liveReducer', () => {
  it('applies a snapshot then flips a device offline on an activity event', () => {
    let state = liveReducer(initialLiveState, {
      type: 'snapshot',
      snapshot: {
        tenantKey: 'alpha',
        lastEventId: '1-0',
        devices: [
          {
            deviceCode: 'LAPTOP-E001',
            deviceType: 'laptop',
            tbDeviceId: null,
            room: '1.O',
            online: true,
            ts: 1,
            values: { battery: 80 },
            activeAlarms: [],
          },
        ],
      },
    });
    expect(state.devices['LAPTOP-E001']?.online).toBe(true);
    expect(state.lastEventId).toBe('1-0');

    state = liveReducer(state, {
      type: 'event',
      event: {
        id: '2-0',
        tenantKey: 'alpha',
        ts: 2,
        kind: 'device.activity',
        deviceCode: 'LAPTOP-E001',
        online: false,
      },
    });
    expect(state.devices['LAPTOP-E001']?.online).toBe(false);
    expect(state.devices['LAPTOP-E001']?.values.battery).toBe(80);
    expect(state.lastEventId).toBe('2-0');
    expect(state.events).toHaveLength(1);
  });

  it('merges telemetry values and derives room light state', () => {
    const state = liveReducer(initialLiveState, {
      type: 'event',
      event: {
        id: '3-0',
        tenantKey: 'alpha',
        ts: 3,
        kind: 'device.telemetry',
        deviceCode: 'LIGHT-1.1',
        deviceType: 'light',
        room: '1.1',
        values: { state: 1, power_w: 60 },
      },
    });
    expect(roomLightsOn(state.devices, '1.1')).toBe(true);
    expect(roomLightsOn(state.devices, '1.2')).toBe(false);
  });

  it('tracks active alarms per device', () => {
    let state = liveReducer(initialLiveState, {
      type: 'event',
      event: {
        id: '4-0',
        tenantKey: 'alpha',
        ts: 4,
        kind: 'alarm',
        deviceCode: 'LAPTOP-E001',
        alarmType: 'Asset unreachable',
        severity: 'WARNING',
        status: 'created',
      },
    });
    expect(state.devices['LAPTOP-E001']?.activeAlarms).toEqual(['Asset unreachable']);
    state = liveReducer(state, {
      type: 'event',
      event: {
        id: '5-0',
        tenantKey: 'alpha',
        ts: 5,
        kind: 'alarm',
        deviceCode: 'LAPTOP-E001',
        alarmType: 'Asset unreachable',
        severity: 'WARNING',
        status: 'cleared',
      },
    });
    expect(state.devices['LAPTOP-E001']?.activeAlarms).toEqual([]);
  });
});
