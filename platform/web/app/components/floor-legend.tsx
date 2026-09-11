import {
  AirVent,
  Coffee,
  Gauge,
  Laptop,
  Lightbulb,
  Monitor,
  Projector,
  Refrigerator,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DeviceGlyph } from '~/components/device-glyph';
import { Card, CardContent } from '~/components/ui/card';
import { DOT_COLOURS } from '~/lib/device-icons';

const KINDS = [
  { icon: Laptop, key: 'devices.laptop' },
  { icon: Lightbulb, key: 'devices.light' },
  { icon: AirVent, key: 'devices.ac' },
  { icon: Users, key: 'devices.occupancy' },
  { icon: Gauge, key: 'devices.room_meter' },
  { icon: Projector, key: 'devices.projector' },
  { icon: Refrigerator, key: 'devices.fridge' },
  { icon: Coffee, key: 'devices.coffee_machine' },
  { icon: Monitor, key: 'devices.monitor' },
] as const;

function Dot({ colour }: { colour: string }) {
  return (
    <span
      className="inline-block size-2.5 rounded-full border-2 border-white shadow-[0_0_0_1px_#d1d5db]"
      style={{ background: colour }}
    />
  );
}

/** What the icons mean, and what the dot on each icon means. */
export function FloorLegend() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="font-medium">{t('floor.legendStatus')}</span>
          <span className="inline-flex items-center gap-2">
            <Dot colour={DOT_COLOURS.green} /> {t('floor.dotGreen')}
          </span>
          <span className="inline-flex items-center gap-2">
            <Dot colour={DOT_COLOURS.red} /> {t('floor.dotRed')}
          </span>
          <span className="inline-flex items-center gap-2">
            <Dot colour={DOT_COLOURS.amber} /> {t('floor.dotAmber')}
          </span>
          <span className="inline-flex items-center gap-2">
            <Dot colour={DOT_COLOURS.grey} /> {t('floor.dotGrey')}
          </span>
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block size-4 rounded-sm border"
              style={{ background: '#fef3c7' }}
            />
            {t('floor.lightOn')}
          </span>
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block size-4 rounded-sm"
              style={{ border: '2px dashed #dc2626' }}
            />
            {t('floor.critical')}
          </span>
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block size-4 rounded-sm"
              style={{ border: '2px dashed #d97706' }}
            />
            {t('floor.legendWasting')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="font-medium">{t('floor.legendDevices')}</span>
          {KINDS.map((k) => (
            <span key={k.key} className="inline-flex items-center gap-2">
              <DeviceGlyph icon={k.icon} dot={null} size="sm" /> {t(k.key)}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
