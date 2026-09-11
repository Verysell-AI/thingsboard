import type { MorningReportData } from '@platform/shared/dto';
import type { TenantBrand } from '../../db/schema/index.js';
import { emailLayout, esc, statTable } from './layout.js';

const REASON_LABELS: Record<string, string> = {
  laptop_online: 'laptop online',
  occupied: 'occupied',
  booking_within_grace: 'booking about to start',
  zone_kept_for: 'zone kept for a late worker',
  manual_hold: 'manual hold',
  critical_room: 'critical room',
  already_off: 'already off',
};

/** Subject and HTML of the morning report for one tenant. Pure. */
export function renderMorningReportEmail(
  brand: TenantBrand,
  data: MorningReportData,
  opts: { reportUrl?: string } = {},
): { subject: string; html: string; text: string } {
  const sweep = data.sweep;
  const money = (v: number) => `${data.currency} ${v.toFixed(2)}`;
  const kwh = (v: number) => `${v.toFixed(1)} kWh`;
  const subject = sweep
    ? `Morning report ${data.date}: ${sweep.roomsOff.length} rooms switched off, ${kwh(sweep.measuredKwhSaved ?? sweep.estimatedKwhSaved)} saved`
    : `Morning report ${data.date}: no evening sweep recorded`;

  const stats = sweep
    ? statTable(
        [
          { label: 'Rooms switched off', value: String(sweep.roomsOff.length) },
          { label: 'Rooms kept on', value: String(sweep.roomsSkipped.length) },
          {
            label: sweep.measuredKwhSaved === null ? 'Estimated saving' : 'Measured saving',
            value: kwh(sweep.measuredKwhSaved ?? sweep.estimatedKwhSaved),
          },
          {
            label: 'Cost saved',
            value: money(sweep.measuredCostSaved ?? sweep.estimatedCostSaved),
          },
        ],
        brand.primaryColor,
      )
    : '<p style="margin:0 0 16px">The evening sweep did not run for this date.</p>';

  const skipped =
    sweep && sweep.roomsSkipped.length
      ? `<h2 style="font-size:14px;margin:16px 0 8px">Rooms kept on and why</h2><ul style="margin:0 0 16px;padding-left:20px">${sweep.roomsSkipped
          .map(
            (r) =>
              `<li><strong>${esc(r.room)}</strong> — ${esc(REASON_LABELS[r.reason] ?? r.reason)}${r.detail ? ` (${esc(r.detail)})` : ''}</li>`,
          )
          .join('')}</ul>`
      : '';
  const kept =
    sweep && sweep.zonesKept.length
      ? `<p style="margin:0 0 16px">Zones kept for late workers: ${sweep.zonesKept
          .map((z) => `<strong>${esc(z.zone)}</strong>${z.employee ? ` (${esc(z.employee)})` : ''}`)
          .join(', ')}.</p>`
      : '';
  const overnight = `<h2 style="font-size:14px;margin:16px 0 8px">Overnight</h2>
<ul style="margin:0 0 16px;padding-left:20px">
<li>${data.alarmsOvernight} alarm(s)</li>
<li>${data.releasedBookings} ghost booking(s) released</li>
<li>${data.unreachableAssets.length} unreachable asset(s)${data.unreachableAssets.length ? `: ${esc(data.unreachableAssets.join(', '))}` : ''}</li>
<li>${data.misplacedAssets.length} misplaced asset(s)${data.misplacedAssets.length ? `: ${esc(data.misplacedAssets.map((m) => `${m.code} in ${m.room}`).join(', '))}` : ''}</li>
</ul>`;
  const link = opts.reportUrl
    ? `<p style="margin:16px 0 0"><a href="${esc(opts.reportUrl)}" style="color:${esc(brand.accentColor)}">Open the report</a></p>`
    : '';
  const note = sweep
    ? `<p style="margin:0 0 16px;font-size:12px;color:#6b7280">${sweep.measuredKwhSaved === null ? 'Savings are estimated from room power at sweep time until overnight meter data and a baseline are available.' : 'Savings measured from the floor meters against the weekday baseline.'}</p>`
    : '';

  const html = emailLayout(
    brand,
    `Morning report · ${data.date}`,
    `${stats}${note}${kept}${skipped}${overnight}${link}`,
  );
  const text = sweep
    ? `Morning report ${data.date}\nRooms off: ${sweep.roomsOff.join(', ') || 'none'}\nRooms kept: ${sweep.roomsSkipped.map((r) => `${r.room} (${r.reason})`).join(', ') || 'none'}\nSaved: ${kwh(sweep.estimatedKwhSaved)} / ${money(sweep.estimatedCostSaved)} (estimated)\nAlarms overnight: ${data.alarmsOvernight}\nGhost bookings released: ${data.releasedBookings}`
    : `Morning report ${data.date}: no evening sweep recorded.`;
  return { subject, html, text };
}
