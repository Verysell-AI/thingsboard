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

const MARKER_R = 11;
const ICON = 14;

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
 * Pure rendering of one floor: rooms from geometry with live power, desks as dots, devices as icon
 * markers coloured by state. Everything visual derives from the live device map so the component
 * renders identically with or without a feed.
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
  const { width, height } = FLOOR_PLAN_VIEWBOX;
  const interactive = Boolean(onSelect);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
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
              rx={8}
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
              strokeWidth={isSelected ? 3 : room.critical || isWasting ? 2 : 1.5}
              strokeDasharray={(room.critical || isWasting) && !isSelected ? '6 4' : undefined}
            />
            {isWasting && (
              <g data-waste-label>
                <rect
                  x={g.x + g.w / 2 - 34}
                  y={g.y + g.h - 24}
                  width={68}
                  height={18}
                  rx={9}
                  fill={WASTE_COLOUR}
                />
                <text
                  x={g.x + g.w / 2}
                  y={g.y + g.h - 11}
                  fontSize={11}
                  fontWeight={700}
                  fill="#ffffff"
                  textAnchor="middle"
                >
                  {t('floor.wasting')}
                </text>
              </g>
            )}
            <text x={g.x + 12} y={g.y + 24} fontSize={16} fontWeight={600} fill="#111827">
              {room.code}
            </text>
            <text x={g.x + 12} y={g.y + 41} fontSize={12} fill="#6b7280">
              {room.name}
              {room.capacity ? ` · ${t('floor.capacity', { count: room.capacity })}` : ''}
            </text>
            {power !== undefined && (
              <text
                x={g.x + g.w - 12}
                y={g.y + 24}
                fontSize={13}
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
                x={g.x + g.w - 12}
                y={g.y + 41}
                fontSize={11}
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
          r={5}
          fill="#e5e7eb"
          stroke="#9ca3af"
        >
          <title>{`${t('floor.desk')} ${desk.code}`}</title>
        </circle>
      ))}

      {plan.devices.map((device, deviceIndex) => {
        const live = devices[device.code];
        // laptops move: at the desk on the home access point, otherwise in a meeting room of the zone
        const placement =
          device.type === 'laptop'
            ? placeLaptop(device, live, plan, devices, deviceIndex % 7)
            : device.x !== null && device.y !== null
              ? { x: device.x, y: device.y, room: null, atDesk: true }
              : null;
        if (!placement) return null;
        const px = placement.x;
        const py = placement.y;
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
                cx={px}
                cy={py}
                r={MARKER_R + 4}
                fill="none"
                stroke="#2563eb"
                strokeWidth={2}
              />
            )}
            <circle
              data-chip
              cx={px}
              cy={py}
              r={MARKER_R}
              fill="#ffffff"
              stroke="#d1d5db"
              strokeWidth={1}
            />
            <Icon
              x={px - ICON / 2}
              y={py - ICON / 2}
              width={ICON}
              height={ICON}
              color={ICON_COLOUR}
              strokeWidth={2}
              aria-hidden
            />
            <circle
              data-status-dot
              cx={px + 8}
              cy={py - 8}
              r={4}
              fill={DOT_COLOURS[dot]}
              stroke="#ffffff"
              strokeWidth={1.5}
            />
            {count > 0 && (
              <>
                <circle cx={px - 9} cy={py - 9} r={7} fill={TONE_COLOURS.online.fg} />
                <text
                  x={px - 9}
                  y={py - 6}
                  fontSize={9}
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
