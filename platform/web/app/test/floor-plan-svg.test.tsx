import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DeviceLiveState, FloorPlan } from '@platform/shared/dto';
import { FloorPlanSvg } from '~/components/floor-plan-svg';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const plan: FloorPlan = {
  floor: {
    id: id(1),
    type: 'FLOOR',
    code: 'F1',
    name: 'Floor 1',
    parentId: null,
    floor: 1,
    zone: null,
    kind: null,
    capacity: null,
    critical: false,
    geometry: null,
    tbAssetId: null,
    accessPoint: null,
  },
  zones: [],
  rooms: [
    {
      id: id(2),
      type: 'ROOM',
      code: '1.1',
      name: 'Meeting room 1.1',
      parentId: id(1),
      floor: 1,
      zone: '1.West',
      kind: 'meeting',
      capacity: 4,
      critical: false,
      geometry: { x: 40, y: 40, w: 160, h: 180 },
      tbAssetId: null,
      accessPoint: null,
    },
    {
      id: id(3),
      type: 'ROOM',
      code: '2.S',
      name: 'Server room',
      parentId: id(1),
      floor: 1,
      zone: '1.East',
      kind: 'server',
      capacity: null,
      critical: true,
      geometry: { x: 700, y: 260, w: 260, h: 300 },
      tbAssetId: null,
      accessPoint: null,
    },
  ],
  desks: [{ code: 'D-1.O-01', room: '1.1', zone: '1.West', x: 100, y: 100, employeeId: null }],
  devices: [
    {
      code: 'LIGHT-1.1',
      type: 'light',
      name: 'Light',
      room: '1.1',
      appliance: null,
      x: 64,
      y: 64,
      assetId: null,
    },
    {
      code: 'LAPTOP-E001',
      type: 'laptop',
      name: 'Laptop',
      room: '1.1',
      appliance: null,
      x: 100,
      y: 100,
      assetId: null,
    },
  ],
};

const live = (code: string, patch: Partial<DeviceLiveState>): DeviceLiveState => ({
  deviceCode: code,
  deviceType: null,
  tbDeviceId: null,
  room: null,
  online: false,
  ts: null,
  values: {},
  activeAlarms: [],
  ...patch,
});

describe('FloorPlanSvg', () => {
  it('renders one rect per room with data-room attributes', () => {
    const { container } = render(<FloorPlanSvg plan={plan} devices={{}} />);
    const groups = container.querySelectorAll('g[data-room]');
    expect(groups).toHaveLength(2);
    expect([...groups].map((g) => g.getAttribute('data-room'))).toEqual(['1.1', '2.S']);
    expect(container.querySelectorAll('g[data-room] > rect')).toHaveLength(2);
    expect(container.querySelector('circle[data-desk="D-1.O-01"]')).not.toBeNull();
  });

  it('marks an off light and an offline laptop with a red dot', () => {
    const devices = {
      'LIGHT-1.1': live('LIGHT-1.1', {
        deviceType: 'light',
        room: '1.1',
        online: true,
        values: { state: 0 },
      }),
      'LAPTOP-E001': live('LAPTOP-E001', { deviceType: 'laptop', room: '1.1', online: false }),
    };
    const { container } = render(<FloorPlanSvg plan={plan} devices={devices} />);
    expect(container.querySelector('g[data-device="LIGHT-1.1"]')?.getAttribute('data-dot')).toBe(
      'red',
    );
    expect(container.querySelector('g[data-device="LAPTOP-E001"]')?.getAttribute('data-dot')).toBe(
      'red',
    );
  });

  it('shows a plug on standby with a grey dot and an active plug with a green dot', () => {
    const plug = {
      code: 'PLUG-1.1-PROJ',
      type: 'plug',
      name: 'Projector plug',
      room: '1.1',
      appliance: 'projector',
      x: 120,
      y: 150,
      assetId: null,
    };
    const withPlug = { ...plan, devices: [...plan.devices, plug] };
    const idle = {
      'PLUG-1.1-PROJ': live('PLUG-1.1-PROJ', {
        deviceType: 'plug',
        online: true,
        values: { state: 1, power_w: 4 },
      }),
    };
    const busy = {
      'PLUG-1.1-PROJ': live('PLUG-1.1-PROJ', {
        deviceType: 'plug',
        online: true,
        values: { state: 1, power_w: 270 },
      }),
    };
    expect(
      render(<FloorPlanSvg plan={withPlug} devices={idle} />)
        .container.querySelector('g[data-device="PLUG-1.1-PROJ"]')
        ?.getAttribute('data-dot'),
    ).toBe('grey');
    expect(
      render(<FloorPlanSvg plan={withPlug} devices={busy} />)
        .container.querySelector('g[data-device="PLUG-1.1-PROJ"]')
        ?.getAttribute('data-dot'),
    ).toBe('green');
  });

  it('tints a room whose light is on and colours laptops by online state', () => {
    const devices = {
      'LIGHT-1.1': live('LIGHT-1.1', {
        deviceType: 'light',
        room: '1.1',
        online: true,
        values: { state: 1 },
      }),
      'LAPTOP-E001': live('LAPTOP-E001', { deviceType: 'laptop', room: '1.1', online: true }),
    };
    const { container } = render(<FloorPlanSvg plan={plan} devices={devices} />);
    const lit = container.querySelector('g[data-room="1.1"]');
    const dark = container.querySelector('g[data-room="2.S"]');
    expect(lit?.getAttribute('data-lights')).toBe('on');
    expect(dark?.getAttribute('data-lights')).toBe('off');
    expect(lit?.querySelector('rect')?.getAttribute('fill')).toBe('#fef3c7');
    const laptop = container.querySelector('g[data-device="LAPTOP-E001"]');
    expect(laptop?.getAttribute('data-status')).toBe('online');
    expect(laptop?.querySelector('circle[data-status-dot]')?.getAttribute('fill')).toBe('#16a34a');
    const light = container.querySelector('g[data-device="LIGHT-1.1"]');
    expect(light?.getAttribute('data-dot')).toBe('green');
    // icons are nested svgs from lucide
    expect(laptop?.querySelector('svg')).not.toBeNull();
  });
});
