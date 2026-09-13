import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceLiveState, FloorPlan } from '@platform/shared/dto';
import { FLOOR_PLAN_VIEWBOX } from '@platform/shared/dataset';
import {
  DOT_COLOURS,
  ICON_COLOUR,
  TONE_COLOURS,
  deviceDot,
  deviceIcon,
  deviceStatus,
} from '~/lib/device-icons';
import { formatPowerW } from '~/lib/format';
import { placeLaptop } from '~/lib/laptop-placement';
import { spreadMarkers } from '~/lib/marker-layout';
import { devicesInRoom, roomLightsOn, type RoomPresence } from '~/lib/live-store';
import { cn } from '~/lib/utils';

export type FloorSelection = { kind: 'room'; code: string } | { kind: 'device'; code: string };

export interface FloorPlanSvgProps {
  plan: FloorPlan;
  devices: Record<string, DeviceLiveState>;
  /** Latest presence per room from the live feed; falls back to the occupancy sensors. */
  presence?: Record<string, RoomPresence>;
  /** Room codes the API flags as wasting energy (empty with lights or AC on). */
  wasting?: ReadonlySet<string>;
  /** Device codes flagged misplaced by the API. */
  misplaced?: ReadonlySet<string>;
  selected?: FloorSelection | null;
  onSelect?: (target: FloorSelection | null) => void;
}

const WASTE_COLOUR = '#d97706';

/**
 * On-screen sizes in CSS pixels. Markers and labels keep these sizes at any plan scale or browser
 * zoom; only the room geometry scales with the container.
 */
const PX = {
  chipR: 14,
  icon: 16,
  chipGap: 6,
  dotR: 4.5,
  badgeR: 8,
  labelInset: 10,
} as const;

/** Space kept around the rooms inside the drawing, in plan units. */
const PLAN_PADDING = 20;

/** Live power of a room from its room meter, if any. */
export function roomPowerW(
  devices: Record<string, DeviceLiveState>,
  room: string,
): number | undefined {
  const meter = devicesInRoom(devices, room).find(
    (d) => d.deviceType === 'room_meter' || d.deviceCode.startsWith('RM-'),
  );
  const v = meter?.values.power_w;
  return typeof v === 'number' ? v : v !== undefined ? Number(v) : undefined;
}

/** People counted in a room by its occupancy sensor. */
export function roomOccupancy(devices: Record<string, DeviceLiveState>, room: string): number {
  const sensor = devicesInRoom(devices, room).find(
    (d) => d.deviceType === 'occupancy' || d.deviceCode.startsWith('OCC-'),
  );
  return sensor ? Number(sensor.values.count ?? 0) : 0;
}

/**
 * The drawing's viewBox: the rooms' bounding box plus an even margin, so the plan is padded the same
 * on every side whatever the dataset's own offsets. Falls back to the dataset canvas without rooms.
 */
export function planViewBox(plan: FloorPlan): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const boxes = plan.rooms.flatMap((r) => (r.geometry ? [r.geometry] : []));
  if (boxes.length === 0) return { x: 0, y: 0, ...FLOOR_PLAN_VIEWBOX };
  const minX = Math.min(...boxes.map((g) => g.x)) - PLAN_PADDING;
  const minY = Math.min(...boxes.map((g) => g.y)) - PLAN_PADDING;
  const maxX = Math.max(...boxes.map((g) => g.x + g.w)) + PLAN_PADDING;
  const maxY = Math.max(...boxes.map((g) => g.y + g.h)) + PLAN_PADDING;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

type PlanDevice = FloorPlan['devices'][number];

interface DevicePlacement {
  device: PlanDevice;
  x: number;
  y: number;
  room: string | null;
  atDesk: boolean;
}

/**
 * Where every device is drawn. Laptops follow `placeLaptop`; the rest use their dataset position.
 * Chips inside one room are then pushed apart so none overlap at the drawn chip radius `chipR`
 * (plan units).
 */
export function placeDevices(
  plan: FloorPlan,
  devices: Record<string, DeviceLiveState>,
  chipR: number,
  gap = 0,
): DevicePlacement[] {
  const placed: DevicePlacement[] = [];
  plan.devices.forEach((device, deviceIndex) => {
    const live = devices[device.code];
    // laptops move: at the desk on the home access point, otherwise in a meeting room of the zone
    const p =
      device.type === 'laptop'
        ? placeLaptop(device, live, plan, devices, deviceIndex % 7, chipR * 2 + gap)
        : device.x !== null && device.y !== null
          ? { x: device.x, y: device.y, room: null, atDesk: true }
          : null;
    if (p) placed.push({ device, ...p });
  });
  const byRoom = new Map<string, DevicePlacement[]>();
  for (const p of placed) {
    const key = p.room ?? p.device.room ?? '';
    byRoom.set(key, [...(byRoom.get(key) ?? []), p]);
  }
  const out: DevicePlacement[] = [];
  for (const [roomCode, group] of byRoom) {
    const g = plan.rooms.find((r) => r.code === roomCode)?.geometry ?? undefined;
    out.push(...spreadMarkers(group, chipR * 2 + gap, g, chipR + 2));
  }
  // keep dataset order so the DOM (and tests) stay stable
  const order = new Map(plan.devices.map((d, i) => [d.code, i]));
  return out.sort((a, b) => (order.get(a.device.code) ?? 0) - (order.get(b.device.code) ?? 0));
}

/** Plan units per CSS pixel for the current rendered width (1 until the element is measured). */
function useUnitsPerPixel(ref: React.RefObject<SVGSVGElement | null>, viewBoxWidth: number) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = (width: number) => {
      if (width > 0) setScale(viewBoxWidth / width);
    };
    update(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) update(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, viewBoxWidth]);
  return scale;
}

/**
 * Pure rendering of one floor: rooms from geometry with live power, desks as dots, devices as icon
 * markers coloured by state. Everything visual derives from the live device map so the component
 * renders identically with or without a feed. Marker and text sizes are fixed in CSS pixels.
 */
export function FloorPlanSvg({
  plan,
  devices,
  presence,
  wasting,
  misplaced,
  selected,
  onSelect,
}: FloorPlanSvgProps) {
  const { t, i18n } = useTranslation();
  const ref = useRef<SVGSVGElement>(null);
  const vb = planViewBox(plan);
  const k = useUnitsPerPixel(ref, vb.width);
  /** CSS pixels → plan units at the current scale. */
  const px = (n: number) => n * k;
  const chipR = px(PX.chipR);
  const icon = px(PX.icon);
  const dotR = px(PX.dotR);
  const dotOffset = chipR - px(2);
  const badgeR = px(PX.badgeR);
  const inset = px(PX.labelInset);
  const interactive = Boolean(onSelect);
  const placements = placeDevices(plan, devices, chipR, px(PX.chipGap));

  return (
    <svg
      ref={ref}
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      className="h-auto w-full rounded-lg border bg-white"
      role="img"
      aria-label={t('floor.title', { floor: plan.floor.floor ?? '' })}
      data-testid="floor-plan"
      onClick={() => onSelect?.(null)}
      style={{ fontFamily: 'inherit' }}
    >
      {plan.rooms.map((room) => {
        const g = room.geometry;
        if (!g) return null;
        const lightsOn = roomLightsOn(devices, room.code);
        const power = roomPowerW(devices, room.code);
        const people = presence?.[room.code]?.count ?? roomOccupancy(devices, room.code);
        const isWasting = wasting?.has(room.code) ?? false;
        const isSelected = selected?.kind === 'room' && selected.code === room.code;
        return (
          <g
            key={room.id}
            data-room={room.code}
            data-lights={lightsOn ? 'on' : 'off'}
            data-wasting={isWasting || undefined}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.({ kind: 'room', code: room.code });
            }}
            className={cn(interactive && 'cursor-pointer')}
          >
            <rect
              x={g.x}
              y={g.y}
              width={g.w}
              height={g.h}
              rx={px(8)}
              fill={lightsOn ? '#fef3c7' : '#f3f4f6'}
              stroke={
                isSelected
                  ? '#2563eb'
                  : room.critical
                    ? '#dc2626'
                    : isWasting
                      ? WASTE_COLOUR
                      : '#9ca3af'
              }
              strokeWidth={px(isSelected ? 3 : room.critical || isWasting ? 2 : 1.5)}
              strokeDasharray={
                (room.critical || isWasting) && !isSelected ? `${px(6)} ${px(4)}` : undefined
              }
            />
            {isWasting && (
              <g data-waste-label>
                <rect
                  x={g.x + g.w / 2 - px(34)}
                  y={g.y + g.h - px(24)}
                  width={px(68)}
                  height={px(18)}
                  rx={px(9)}
                  fill={WASTE_COLOUR}
                />
                <text
                  x={g.x + g.w / 2}
                  y={g.y + g.h - px(11)}
                  fontSize={px(11)}
                  fontWeight={700}
                  fill="#ffffff"
                  textAnchor="middle"
                >
                  {t('floor.wasting')}
                </text>
              </g>
            )}
            <text
              x={g.x + inset}
              y={g.y + inset + px(13)}
              fontSize={px(15)}
              fontWeight={600}
              fill="#111827"
            >
              {room.code}
            </text>
            <text x={g.x + inset} y={g.y + inset + px(29)} fontSize={px(11.5)} fill="#6b7280">
              {room.name}
              {room.capacity ? ` · ${t('floor.capacity', { count: room.capacity })}` : ''}
            </text>
            {power !== undefined && (
              <text
                x={g.x + g.w - inset}
                y={g.y + inset + px(13)}
                fontSize={px(12.5)}
                fontWeight={600}
                fill="#374151"
                textAnchor="end"
                direction="ltr"
              >
                {formatPowerW(power, i18n.language)}
              </text>
            )}
            {people > 0 && (
              <text
                x={g.x + g.w - inset}
                y={g.y + inset + px(29)}
                fontSize={px(11)}
                fontWeight={600}
                fill={TONE_COLOURS.online.fg}
                textAnchor="end"
              >
                {t('telemetry.people', { count: people })}
              </text>
            )}
            <title>{`${room.name} (${room.code})`}</title>
          </g>
        );
      })}

      {plan.desks.map((desk) => (
        <circle
          key={desk.code}
          data-desk={desk.code}
          cx={desk.x}
          cy={desk.y}
          r={px(5)}
          fill="#e5e7eb"
          stroke="#9ca3af"
          strokeWidth={px(1)}
        >
          <title>{`${t('floor.desk')} ${desk.code}`}</title>
        </circle>
      ))}

      {placements.map((placement) => {
        const { device } = placement;
        const live = devices[device.code];
        const cx = placement.x;
        const cy = placement.y;
        const status = deviceStatus(device, live);
        const isMisplaced = misplaced?.has(device.code) ?? false;
        const dot = isMisplaced ? 'amber' : deviceDot(device, live);
        const Icon = deviceIcon(device);
        const isSelected = selected?.kind === 'device' && selected.code === device.code;
        const count = device.type === 'occupancy' && live ? Number(live.values.count ?? 0) : 0;
        return (
          <g
            key={device.code}
            data-device={device.code}
            data-device-type={device.type}
            data-status={status}
            data-dot={dot}
            data-online={live?.online ? 'true' : 'false'}
            data-misplaced={isMisplaced || undefined}
            data-placed-room={placement.room ?? undefined}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.({ kind: 'device', code: device.code });
            }}
            className={cn(interactive && 'cursor-pointer')}
          >
            {isSelected && (
              <circle
                cx={cx}
                cy={cy}
                r={chipR + px(4)}
                fill="none"
                stroke="#2563eb"
                strokeWidth={px(2)}
              />
            )}
            <circle
              data-chip
              cx={cx}
              cy={cy}
              r={chipR}
              fill="#ffffff"
              stroke="#d1d5db"
              strokeWidth={px(1)}
            />
            <Icon
              x={cx - icon / 2}
              y={cy - icon / 2}
              width={icon}
              height={icon}
              color={ICON_COLOUR}
              strokeWidth={2}
              aria-hidden
            />
            <circle
              data-status-dot
              cx={cx + dotOffset}
              cy={cy - dotOffset}
              r={dotR}
              fill={DOT_COLOURS[dot]}
              stroke="#ffffff"
              strokeWidth={px(1.5)}
            />
            {count > 0 && (
              <>
                <circle
                  cx={cx - dotOffset}
                  cy={cy - dotOffset}
                  r={badgeR}
                  fill={TONE_COLOURS.online.fg}
                />
                <text
                  x={cx - dotOffset}
                  y={cy - dotOffset + px(3.5)}
                  fontSize={px(10)}
                  fontWeight={700}
                  fill="#ffffff"
                  textAnchor="middle"
                >
                  {count}
                </text>
              </>
            )}
            <title>{`${device.name} (${device.code}) · ${isMisplaced ? t('floor.misplaced') : t(`status.${status}`)}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
