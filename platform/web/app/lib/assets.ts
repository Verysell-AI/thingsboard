import type { AssetsQuery } from '@platform/shared/dto';

/** Filters kept in the URL so a register view is linkable; `asset` opens the drawer. */
export interface AssetFilters {
  search?: string;
  class?: string;
  type?: string;
  floor?: number;
  room?: string;
  custodianId?: string;
  status?: AssetsQuery['status'];
  exceptions?: boolean;
  sort?: AssetsQuery['sort'];
  order?: AssetsQuery['order'];
  page?: number;
  pageSize?: number;
}

/** Builds the query string for GET /assets; empty values are dropped so URLs stay short. */
export function assetsQueryString(f: AssetFilters): string {
  const sp = new URLSearchParams();
  if (f.search?.trim()) sp.set('search', f.search.trim());
  if (f.class) sp.set('class', f.class);
  if (f.type) sp.set('type', f.type);
  if (f.floor !== undefined && !Number.isNaN(f.floor)) sp.set('floor', String(f.floor));
  if (f.room) sp.set('room', f.room);
  if (f.custodianId) sp.set('custodianId', f.custodianId);
  if (f.status) sp.set('status', f.status);
  if (f.exceptions) sp.set('exceptions', 'true');
  if (f.sort && f.sort !== 'code') sp.set('sort', f.sort);
  if (f.order && f.order !== 'asc') sp.set('order', f.order);
  if (f.page) sp.set('page', String(f.page));
  if (f.pageSize && f.pageSize !== 50) sp.set('pageSize', String(f.pageSize));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Reads the same filters back from a URLSearchParams (the route's search params). */
export function assetFiltersFrom(sp: URLSearchParams): AssetFilters {
  const floor = sp.get('floor');
  const page = sp.get('page');
  const pageSize = sp.get('pageSize');
  const status = sp.get('status');
  const sort = sp.get('sort');
  const order = sp.get('order');
  return {
    search: sp.get('search') ?? undefined,
    class: sp.get('class') ?? undefined,
    type: sp.get('type') ?? undefined,
    floor: floor ? Number(floor) : undefined,
    room: sp.get('room') ?? undefined,
    custodianId: sp.get('custodianId') ?? undefined,
    status: status ? (status as AssetsQuery['status']) : undefined,
    exceptions: sp.get('exceptions') === 'true',
    sort: sort ? (sort as AssetsQuery['sort']) : undefined,
    order: order ? (order as AssetsQuery['order']) : undefined,
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
  };
}

/** Telemetry keys worth charting per device type. */
export function historyKeysFor(deviceType: string | null): string[] {
  switch (deviceType) {
    case 'laptop':
      return ['battery', 'cpu'];
    case 'ac':
      return ['power_w', 'room_temp_c', 'current_a'];
    case 'occupancy':
      return ['count'];
    case 'room_meter':
    case 'floor_meter':
      return ['power_w', 'energy_kwh'];
    case 'light':
    case 'plug':
      return ['power_w', 'energy_kwh'];
    default:
      return ['power_w'];
  }
}
