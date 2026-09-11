import {
  AirVent,
  Coffee,
  Gauge,
  Heater,
  Laptop,
  Lightbulb,
  Monitor,
  Plug,
  Projector,
  Refrigerator,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { DeviceLiveState } from '@platform/shared/dto';

/** Visual tone of a device marker; each maps to one colour pair used on the plan and in panels. */
export type Tone = 'on' | 'cool' | 'online' | 'off' | 'warning' | 'alarm' | 'neutral';

export const TONE_COLOURS: Record<Tone, { fg: string; bg: string }> = {
  on: { fg: '#d97706', bg: '#fef3c7' }, // amber: lights / appliances drawing power
  cool: { fg: '#2563eb', bg: '#dbeafe' }, // blue: air conditioning running
  online: { fg: '#16a34a', bg: '#dcfce7' }, // green: laptop online / room occupied
  off: { fg: '#9ca3af', bg: '#f3f4f6' }, // grey: off or offline
  warning: { fg: '#d97706', bg: '#fef3c7' },
  alarm: { fg: '#dc2626', bg: '#fee2e2' },
  neutral: { fg: '#6b7280', bg: '#f3f4f6' }, // meters and sensors that are simply reporting
};

export interface DeviceLike {
  type: string;
  code: string;
  appliance?: string | null;
}

export function deviceIcon(device: DeviceLike): LucideIcon {
  switch (device.type) {
    case 'light':
      return Lightbulb;
    case 'ac':
      return AirVent;
    case 'laptop':
      return Laptop;
    case 'occupancy':
      return Users;
    case 'room_meter':
      return Gauge;
    case 'floor_meter':
      return Zap;
    case 'plug':
      switch (device.appliance ?? inferAppliance(device.code)) {
        case 'projector':
          return Projector;
        case 'fridge':
          return Refrigerator;
        case 'coffee_machine':
          return Coffee;
        case 'monitor':
          return Monitor;
        case 'heater':
          return Heater;
        default:
          return Plug;
      }
    default:
      return Plug;
  }
}

/** Dataset plug codes end with the appliance (PLUG-1.P-FRIDGE); used only when meta is missing. */
function inferAppliance(code: string): string | null {
  const tail = code.split('-').pop()?.toUpperCase() ?? '';
  if (tail.startsWith('PROJ')) return 'projector';
  if (tail.startsWith('FRIDGE')) return 'fridge';
  if (tail.startsWith('COFFEE')) return 'coffee_machine';
  if (tail.startsWith('MON')) return 'monitor';
  if (tail.startsWith('HEAT')) return 'heater';
  return null;
}

/** i18n key of the human label for a device type or plug appliance. */
export function deviceKindKey(device: DeviceLike): string {
  if (device.type === 'plug') {
    const appliance = device.appliance ?? inferAppliance(device.code);
    return appliance ? `devices.${appliance}` : 'devices.plug';
  }
  return `devices.${device.type}`;
}

/** Status of a device for colouring and for the status text in panels. */
export type DeviceStatus =
  | 'alarm'
  | 'online'
  | 'offline'
  | 'on'
  | 'standby'
  | 'off'
  | 'occupied'
  | 'empty'
  | 'reporting'
  | 'unknown';

/** A plug whose relay is on but that draws less than this is idle (projector inference, context). */
export const PLUG_IN_USE_THRESHOLD_W = 20;

export function deviceStatus(device: DeviceLike, live: DeviceLiveState | undefined): DeviceStatus {
  if (!live) return 'unknown';
  if (live.activeAlarms.length > 0) return 'alarm';
  switch (device.type) {
    case 'laptop':
      return live.online ? 'online' : 'offline';
    case 'light':
    case 'ac':
      if (!live.online) return 'offline';
      return Number(live.values.state) === 1 ? 'on' : 'off';
    case 'plug': {
      if (!live.online) return 'offline';
      if (Number(live.values.state) !== 1) return 'off';
      const power = Number(live.values.power_w ?? NaN);
      return Number.isNaN(power) || power >= PLUG_IN_USE_THRESHOLD_W ? 'on' : 'standby';
    }
    case 'occupancy':
      if (!live.online) return 'offline';
      return Number(live.values.occupied) === 1 ? 'occupied' : 'empty';
    default:
      return live.online ? 'reporting' : 'offline';
  }
}

export function statusTone(device: DeviceLike, status: DeviceStatus): Tone {
  switch (status) {
    case 'alarm':
      return 'alarm';
    case 'online':
    case 'occupied':
      return 'online';
    case 'on':
      return device.type === 'ac' ? 'cool' : 'on';
    case 'reporting':
    case 'standby':
    case 'unknown':
      return 'neutral';
    default:
      return 'off';
  }
}

export function deviceTone(device: DeviceLike, live: DeviceLiveState | undefined): Tone {
  return statusTone(device, deviceStatus(device, live));
}

/** Status dot drawn on top of a device icon: green = in use / on / online, red = off / offline. */
export type Dot = 'green' | 'red' | 'amber' | 'grey';

export const DOT_COLOURS: Record<Dot, string> = {
  green: '#16a34a',
  red: '#dc2626',
  amber: '#f59e0b',
  grey: '#9ca3af',
};

export function statusDot(status: DeviceStatus): Dot {
  switch (status) {
    case 'alarm':
      return 'amber';
    case 'on':
    case 'online':
    case 'occupied':
    case 'reporting':
      return 'green';
    case 'off':
    case 'offline':
    case 'empty':
      return 'red';
    case 'standby':
    default:
      return 'grey';
  }
}

export function deviceDot(device: DeviceLike, live: DeviceLiveState | undefined): Dot {
  return statusDot(deviceStatus(device, live));
}

/** Icon colour on the plan and in panels: neutral, so state is carried by the dot alone. */
export const ICON_COLOUR = '#374151';
