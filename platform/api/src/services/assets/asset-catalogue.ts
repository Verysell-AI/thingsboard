import { LAPTOP_INACTIVITY_TIMEOUT_MS } from '@platform/shared/contracts';
import type { Room, WorldDevice } from '@platform/shared/dataset';

/**
 * What the platform knows about each device family when it registers one: catalogue data for the
 * asset master and the ThingsBoard server attributes the device profiles' alarm rules read.
 * Shared by the dataset loader and the new-employee flow.
 */
export const ASSET_CATALOGUE: Record<
  string,
  { brand: string; model: string; cost: number; life: number; category: string }
> = {
  light: { brand: 'Lumenor', model: 'LX-Panel 40', cost: 180, life: 8, category: 'Lighting' },
  ac: { brand: 'Frostline', model: 'FL-Split 12k', cost: 2400, life: 10, category: 'HVAC' },
  occupancy: { brand: 'Sensora', model: 'PIR-360', cost: 95, life: 6, category: 'Sensors' },
  plug: { brand: 'Sensora', model: 'SmartPlug 16A', cost: 45, life: 5, category: 'Metering' },
  room_meter: { brand: 'Metrix', model: 'RM-1P', cost: 320, life: 12, category: 'Metering' },
  floor_meter: { brand: 'Metrix', model: 'FM-3P', cost: 1450, life: 15, category: 'Metering' },
  laptop: { brand: 'Nordbook', model: 'Pro 14', cost: 5200, life: 4, category: 'IT equipment' },
};

export function hashInt(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface PurchaseData {
  brand: string;
  model: string;
  serial: string;
  category: string;
  purchaseDate: string;
  purchaseCost: string;
  usefulLifeYears: number;
  warrantyEnd: string;
}

/**
 * Deterministic purchase data for a device code. Dataset devices were bought within ~2.5 years
 * before 2024-01-15; a freshly registered asset (`boughtAtMs`) is bought today with a 3-year warranty.
 */
export function purchaseData(code: string, type: string, boughtAtMs?: number): PurchaseData {
  const cat = ASSET_CATALOGUE[type] ?? ASSET_CATALOGUE.plug!;
  const purchase =
    boughtAtMs === undefined
      ? new Date(Date.UTC(2024, 0, 15) - (hashInt(code) % 900) * 86_400_000)
      : new Date(boughtAtMs);
  const warranty = new Date(purchase);
  warranty.setUTCFullYear(warranty.getUTCFullYear() + 3);
  return {
    brand: cat.brand,
    model: cat.model,
    serial: `${type.toUpperCase().slice(0, 3)}-${hashInt(`${code}:serial`).toString(16).toUpperCase().padStart(8, '0')}`,
    category: cat.category,
    purchaseDate: purchase.toISOString().slice(0, 10),
    purchaseCost: cat.cost.toFixed(2),
    usefulLifeYears: cat.life,
    warrantyEnd: warranty.toISOString().slice(0, 10),
  };
}

/** Server attributes for a dataset device; alarm rules compare telemetry against these as is. */
export function deviceAttributes(
  device: WorldDevice,
  room: Room | undefined,
): Record<string, string | number | boolean> {
  const base: Record<string, string | number | boolean> = { ...device.attrs };
  if ('room' in device && room) {
    base.room = room.code;
    base.zone = room.zone;
    base.critical = room.critical;
    base.floor = room.floor;
  }
  switch (device.type) {
    case 'ac':
      base.nominal_current_a = device.nominalCurrentA;
      base.ac_current_alarm_a = Math.round(device.nominalCurrentA * 1.25 * 100) / 100;
      base.ac_current_clear_a = Math.round(device.nominalCurrentA * 1.1 * 100) / 100;
      base.nominal_power_w = device.nominalPowerW;
      break;
    case 'light':
      base.nominal_power_w = device.nominalPowerW;
      break;
    case 'plug':
      base.appliance = device.appliance;
      base.sweepable = device.sweepable;
      base.nominal_power_w = device.nominalPowerW;
      break;
    case 'room_meter':
      base.night_baseline_w = device.nightBaselineW;
      base.night_anomaly_w = device.nightBaselineW * 2;
      break;
    case 'floor_meter':
      base.floor = device.floor;
      break;
    default:
      break;
  }
  return base;
}

/** Server attributes for an employee's laptop. */
export function laptopAttributes(input: {
  employeeId: string;
  employeeCode: string;
  room: string;
  zone: string | null;
}): Record<string, string | number | boolean> {
  return {
    employee_id: input.employeeId,
    employee_code: input.employeeCode,
    inactivityTimeout: LAPTOP_INACTIVITY_TIMEOUT_MS,
    room: input.room,
    zone: input.zone ?? '',
  };
}

/** Telemetry `user` value for an employee: firstname.lastname in lowercase. */
export function userNameFor(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join('.');
}
