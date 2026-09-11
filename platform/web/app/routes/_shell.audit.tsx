import { useQuery } from '@tanstack/react-query';
import { Download, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';
import { AuditFacetsSchema, AuditResponseSchema, type MeResponse } from '@platform/shared/dto';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Select } from '~/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { api } from '~/lib/api';
import { formatDateTime } from '~/lib/format';
import { cn } from '~/lib/utils';

const READ_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER']);
const PAGE_SIZE = 50;

type AuditRow = {
  id: string;
  ts: string;
  actorType: string;
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
};

/** Keys whose value differs between before and after (top level), for the diff viewer. Pure. */
export function changedKeys(before: unknown, after: unknown): Set<string> {
  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out = new Set<string>();
  for (const k of keys) if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) out.add(k);
  return out;
}

/** Query string for the audit endpoints from the filter state. Pure. */
export function auditQueryString(
  f: { actor: string; action: string; entityType: string; from: string; to: string },
  page?: number,
): string {
  const sp = new URLSearchParams();
  if (f.actor) sp.set('actor', f.actor);
  if (f.action) sp.set('action', f.action);
  if (f.entityType) sp.set('entityType', f.entityType);
  if (f.from) sp.set('from', new Date(f.from).toISOString());
  if (f.to) sp.set('to', new Date(f.to).toISOString());
  if (page !== undefined) {
    sp.set('page', String(page));
    sp.set('pageSize', String(PAGE_SIZE));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export default function AuditRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const [filters, setFilters] = useState({
    actor: '',
    action: '',
    entityType: '',
    from: '',
    to: '',
  });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const facets = useQuery({
    queryKey: ['audit', 'facets'],
    queryFn: () => api.get('/audit/facets', AuditFacetsSchema),
    enabled: READ_ROLES.has(me.user.role),
    staleTime: 60_000,
  });
  const query = useQuery({
    queryKey: ['audit', filters, page],
    queryFn: () => api.get(`/audit${auditQueryString(filters, page)}`, AuditResponseSchema),
    enabled: READ_ROLES.has(me.user.role),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  });
  if (!READ_ROLES.has(me.user.role))
    return (
      <Alert variant="info" className="max-w-xl">
        <AlertDescription>{t('audit.forbidden')}</AlertDescription>
      </Alert>
    );
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(0);
  };
  return (
    <div className="flex flex-col gap-4" data-testid="audit-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('audit.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {data ? t('audit.count', { count: data.total }) : t('app.loading')}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            api.download(
              `/audit/export.csv${auditQueryString(filters)}`,
              `audit-${me.tenant.key}.csv`,
            )
          }
          data-testid="audit-export"
        >
          <Download aria-hidden /> {t('reports.exportCsv')}
        </Button>
      </div>
      <div className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-actor">{t('audit.actor')}</Label>
          <Input
            id="audit-actor"
            list="audit-actors"
            value={filters.actor}
            onChange={(e) => set('actor', e.target.value)}
            placeholder={t('audit.actorPlaceholder')}
          />
          <datalist id="audit-actors">
            {(facets.data?.actors ?? []).map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-action">{t('audit.action')}</Label>
          <Select
            id="audit-action"
            value={filters.action}
            onChange={(e) => set('action', e.target.value)}
          >
            <option value="">{t('audit.any')}</option>
            {(facets.data?.actions ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-entity">{t('audit.entity')}</Label>
          <Select
            id="audit-entity"
            value={filters.entityType}
            onChange={(e) => set('entityType', e.target.value)}
          >
            <option value="">{t('audit.any')}</option>
            {(facets.data?.entityTypes ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-from">{t('audit.from')}</Label>
          <Input
            id="audit-from"
            type="datetime-local"
            value={filters.from}
            onChange={(e) => set('from', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-to">{t('audit.to')}</Label>
          <Input
            id="audit-to"
            type="datetime-local"
            value={filters.to}
            onChange={(e) => set('to', e.target.value)}
          />
        </div>
      </div>
      {data && data.items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <ScrollText className="size-6" aria-hidden />
            {t('audit.empty')}
          </CardContent>
        </Card>
      )}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('audit.when')}</TableHead>
                <TableHead>{t('audit.actor')}</TableHead>
                <TableHead>{t('audit.action')}</TableHead>
                <TableHead>{t('audit.entity')}</TableHead>
                <TableHead>{t('audit.entityId')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((row) => (
                <AuditRowView
                  key={row.id}
                  row={row}
                  open={open === row.id}
                  onToggle={() => setOpen(open === row.id ? null : row.id)}
                  locale={i18n.language}
                  timeZone={me.tenant.timeZone}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{t('assets.page', { page: page + 1, pages })}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 0}
              onClick={() => setPage(page - 1)}
            >
              {t('assets.prev')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pages}
              onClick={() => setPage(page + 1)}
            >
              {t('assets.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditRowView({
  row,
  open,
  onToggle,
  locale,
  timeZone,
}: {
  row: AuditRow;
  open: boolean;
  onToggle: () => void;
  locale: string;
  timeZone: string;
}) {
  const { t } = useTranslation();
  const denied = row.action === 'DENIED';
  const changed = changedKeys(row.before, row.after);
  return (
    <>
      <TableRow
        className={cn('cursor-pointer', open && 'bg-muted/40')}
        onClick={onToggle}
        data-testid="audit-row"
        data-action={row.action}
      >
        <TableCell className="whitespace-nowrap" dir="ltr">
          {formatDateTime(row.ts, locale, timeZone)}
        </TableCell>
        <TableCell>
          <span>{row.actorLabel ?? '—'}</span>{' '}
          <Badge variant="outline">
            {t(`audit.actorType.${row.actorType}`, { defaultValue: row.actorType })}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge
            variant={
              denied ? 'destructive' : row.action.startsWith('command.') ? 'accent' : 'secondary'
            }
            dir="ltr"
          >
            {row.action}
          </Badge>
        </TableCell>
        <TableCell dir="ltr">{row.entityType}</TableCell>
        <TableCell className="max-w-56 truncate font-mono text-xs" dir="ltr">
          {row.entityId ?? '—'}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-muted/20">
          <TableCell colSpan={5}>
            <div className="grid gap-3 md:grid-cols-2" data-testid="audit-diff">
              <DiffPane label={t('audit.before')} value={row.before} changed={changed} />
              <DiffPane label={t('audit.after')} value={row.after} changed={changed} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function DiffPane({
  label,
  value,
  changed,
}: {
  label: string;
  value: unknown;
  changed: Set<string>;
}) {
  const { t } = useTranslation();
  if (value === null || value === undefined)
    return (
      <div>
        <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </h4>
        <p className="text-xs text-muted-foreground">{t('audit.none')}</p>
      </div>
    );
  const obj = typeof value === 'object' ? (value as Record<string, unknown>) : { value };
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </h4>
      <dl className="rounded-md border bg-card font-mono text-xs" dir="ltr">
        {Object.entries(obj).map(([k, v]) => (
          <div
            key={k}
            className={cn(
              'flex gap-2 border-b px-2 py-1 last:border-b-0',
              changed.has(k) && 'bg-accent/15',
            )}
          >
            <dt className="w-32 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="break-all">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
