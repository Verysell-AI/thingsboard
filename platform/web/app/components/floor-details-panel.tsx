import { ExternalLink, MousePointerClick, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { DeviceLiveState, FloorPlan } from '@platform/shared/dto';
import type { FloorSelection } from '~/components/floor-plan-svg';
import { roomOccupancy, roomPowerW } from '~/components/floor-plan-svg';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { DeviceGlyph } from '~/components/device-glyph';
import {
  deviceDot,
  deviceIcon,
  deviceKindKey,
  deviceStatus,
  type DeviceStatus,
} from '~/lib/device-icons';
import { formatAgo, formatPowerW, formatValues, summarizeValues } from '~/lib/format';
import { roomAcOn, roomLightsOn } from '~/lib/live-store';

type PlanDevice = FloorPlan['devices'][number];

const STATUS_VARIANT: Record<
  DeviceStatus,
  'success' | 'secondary' | 'warning' | 'destructive' | 'accent'
> = {
  alarm: 'destructive',
  online: 'success',
  occupied: 'success',
  on: 'warning',
  reporting: 'accent',
  standby: 'secondary',
  offline: 'secondary',
  off: 'secondary',
  empty: 'secondary',
  unknown: 'secondary',
};

export interface FloorDetailsPanelProps {
  plan: FloorPlan;
  devices: Record<string, DeviceLiveState>;
  selected: FloorSelection | null;
  onSelect: (target: FloorSelection | null) => void;
}

/** Live details for the selected room or device; the floor plan is the picker. */
export function FloorDetailsPanel({ plan, devices, selected, onSelect }: FloorDetailsPanelProps) {
  const { t } = useTranslation();

  if (!selected) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
          <MousePointerClick className="size-6" aria-hidden />
          {t('floor.selectHint')}
        </CardContent>
      </Card>
    );
  }

  if (selected.kind === 'room') {
    const room = plan.rooms.find((r) => r.code === selected.code);
    if (!room) return null;
    const roomDevices = plan.devices.filter((d) => d.room === room.code);
    return (
      <Card className="h-full">
        <PanelHeader
          title={room.name}
          subtitle={room.code}
          onClose={() => onSelect(null)}
          closeLabel={t('floor.close')}
        />
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{t(`rooms.kind.${room.kind ?? 'other'}`)}</Badge>
            {room.capacity ? (
              <Badge variant="outline">{t('floor.capacity', { count: room.capacity })}</Badge>
            ) : null}
            {room.critical && <Badge variant="destructive">{t('floor.critical')}</Badge>}
            <Button asChild variant="outline" size="sm" className="ms-auto">
              <Link to={`/rooms/${room.id}`} data-testid="open-room">
                <ExternalLink aria-hidden /> {t('floor.openRoom')}
              </Link>
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat
              label={t('floor.powerNow')}
              value={formatPowerW(roomPowerW(devices, room.code), 'en')}
            />
            <Stat label={t('floor.people')} value={String(roomOccupancy(devices, room.code))} />
            <Stat
              label={t('devices.light')}
              value={roomLightsOn(devices, room.code) ? t('status.on') : t('status.off')}
            />
            <Stat
              label={t('devices.ac')}
              value={roomAcOn(devices, room.code) ? t('status.on') : t('status.off')}
            />
          </dl>
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('floor.devicesInRoom', { count: roomDevices.length })}
            </h3>
            <ul className="flex flex-col divide-y">
              {roomDevices.map((d) => (
                <DeviceRow key={d.code} device={d} live={devices[d.code]} onSelect={onSelect} />
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    );
  }

  const device = plan.devices.find((d) => d.code === selected.code);
  if (!device) return null;
  const live = devices[device.code];
  const status = deviceStatus(device, live);
  const Icon = deviceIcon(device);
  const values = live ? formatValues(live.values, t, 'en') : [];

  return (
    <Card className="h-full">
      <PanelHeader
        title={device.name}
        subtitle={`${device.code} · ${t(deviceKindKey(device))}`}
        icon={<DeviceGlyph icon={Icon} dot={deviceDot(device, live)} size="lg" />}
        onClose={() => onSelect(null)}
        closeLabel={t('floor.close')}
      />
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</Badge>
          {device.room && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => onSelect({ kind: 'room', code: device.room! })}
            >
              {t('floor.inRoom', { room: device.room })}
            </Button>
          )}
          {device.assetId && (
            <Button asChild variant="outline" size="sm" className="ms-auto">
              <Link
                to={`/assets?asset=${encodeURIComponent(device.assetId)}`}
                data-testid="open-asset"
              >
                <ExternalLink aria-hidden /> {t('floor.openAsset')}
              </Link>
            </Button>
          )}
        </div>
        {live?.activeAlarms.length ? (
          <ul className="flex flex-col gap-1 text-sm text-destructive">
            {live.activeAlarms.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : null}
        {values.length > 0 ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {values.map((v) => (
              <Stat key={v.key} label={v.label} value={v.text} />
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t('floor.noData')}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {t('floor.lastUpdate', { ago: formatAgo(live?.ts, t, 'en') })}
        </p>
      </CardContent>
    </Card>
  );
}

function PanelHeader({
  title,
  subtitle,
  icon,
  onClose,
  closeLabel,
}: {
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <CardHeader className="flex flex-row items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <CardTitle className="truncate text-base">{title}</CardTitle>
          <p className="truncate text-xs text-muted-foreground" dir="ltr">
            {subtitle}
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="-me-2 -mt-2 shrink-0"
        onClick={onClose}
        aria-label={closeLabel}
      >
        <X aria-hidden />
      </Button>
    </CardHeader>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/60 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium" dir="ltr">
        {value}
      </dd>
    </div>
  );
}

function DeviceRow({
  device,
  live,
  onSelect,
}: {
  device: PlanDevice;
  live: DeviceLiveState | undefined;
  onSelect: (target: FloorSelection) => void;
}) {
  const { t } = useTranslation();
  const Icon = deviceIcon(device);
  const status = deviceStatus(device, live);
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-3 py-2 text-start text-sm hover:bg-muted/60"
        onClick={() => onSelect({ kind: 'device', code: device.code })}
      >
        <DeviceGlyph icon={Icon} dot={deviceDot(device, live)} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{device.name}</span>
          <span className="block truncate text-xs text-muted-foreground" dir="ltr">
            {live
              ? summarizeValues(live.values, t, 'en', 2) || t(`status.${status}`)
              : t('status.unknown')}
          </span>
        </span>
        <Badge variant={STATUS_VARIANT[status]} className="shrink-0">
          {t(`status.${status}`)}
        </Badge>
      </button>
    </li>
  );
}
