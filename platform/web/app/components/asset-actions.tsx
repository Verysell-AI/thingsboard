import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RPC_SUPPORT } from '@platform/shared/contracts';
import type { Asset, Command, CommandRequest, DeviceLiveState } from '@platform/shared/dto';
import { CommandSchema } from '@platform/shared/dto';
import { canCommand, type Role } from '@platform/shared/roles';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { Switch } from '~/components/ui/switch';
import { api, isApiError } from '~/lib/api';
import { formatDateTime } from '~/lib/format';

const SETPOINT_MIN = 16;
const SETPOINT_MAX = 30;

/**
 * Control panel of a device asset: on/off for lights, plugs and AC units, a setpoint stepper for AC.
 * Roles without command rights see the controls disabled with an explanation; a 403 from the API is
 * shown as-is so the demo can make the refusal visible.
 */
export function AssetActions({
  asset,
  live,
  role,
  timeZone,
}: {
  asset: Asset;
  live: DeviceLiveState | undefined;
  role: Role;
  timeZone: string;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const allowed = canCommand(role);
  const type = asset.deviceType ?? asset.type;
  const supportsState = RPC_SUPPORT.setState.includes(type);
  const supportsSetpoint = RPC_SUPPORT.setSetpoint.includes(type);
  const liveState = Number(live?.values.state ?? NaN);
  const liveSetpoint = Number(live?.values.setpoint_c ?? NaN);
  const [optimisticState, setOptimisticState] = useState<0 | 1 | null>(null);
  const [setpoint, setSetpoint] = useState<number | null>(null);
  const [last, setLast] = useState<Command | null>(null);

  const command = useMutation({
    mutationFn: (body: CommandRequest) =>
      api.post(`/assets/${asset.id}/commands`, body, CommandSchema),
    onSuccess: (cmd) => {
      setLast(cmd);
      void queryClient.invalidateQueries({ queryKey: ['asset', asset.id] });
    },
    onError: () => setOptimisticState(null),
  });

  if (!supportsState && !supportsSetpoint) {
    return <p className="text-sm text-muted-foreground">{t('assets.actions.none')}</p>;
  }

  const shownState = optimisticState ?? (Number.isNaN(liveState) ? 0 : (liveState as 0 | 1));
  const shownSetpoint = setpoint ?? (Number.isNaN(liveSetpoint) ? 23 : liveSetpoint);
  const disabledReason = !allowed
    ? t('assets.actions.forbiddenRole', { role: t(`roles.${role}`) })
    : !live?.online
      ? t('assets.actions.offline')
      : undefined;
  const disabled = !allowed || command.isPending;

  return (
    <div className="flex flex-col gap-5" data-testid="asset-actions">
      {!allowed && (
        <Alert variant="info">
          <AlertDescription className="flex items-center gap-2">
            <ShieldOff className="size-4 shrink-0" aria-hidden />
            {t('assets.actions.forbiddenRole', { role: t(`roles.${role}`) })}
          </AlertDescription>
        </Alert>
      )}

      {supportsState && (
        <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
          <div>
            <Label htmlFor={`switch-${asset.id}`}>{t('assets.actions.power')}</Label>
            <p className="text-xs text-muted-foreground">
              {shownState === 1 ? t('status.on') : t('status.off')}
              {optimisticState !== null && optimisticState !== liveState
                ? ` · ${t('assets.actions.pending')}`
                : ''}
            </p>
          </div>
          <span title={disabledReason}>
            <Switch
              id={`switch-${asset.id}`}
              checked={shownState === 1}
              disabled={disabled}
              aria-label={t('assets.actions.power')}
              onCheckedChange={(next) => {
                const state = next ? 1 : 0;
                setOptimisticState(state);
                command.mutate({ method: 'setState', params: { state } });
              }}
            />
          </span>
        </div>
      )}

      {supportsSetpoint && (
        <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
          <div>
            <Label>{t('assets.actions.setpoint')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('assets.actions.setpointRange', { min: SETPOINT_MIN, max: SETPOINT_MAX })}
            </p>
          </div>
          <div className="flex items-center gap-2" title={disabledReason} dir="ltr">
            <Button
              variant="outline"
              size="icon"
              disabled={disabled || shownSetpoint <= SETPOINT_MIN}
              aria-label={t('assets.actions.decrease')}
              onClick={() => setSetpoint(Math.max(SETPOINT_MIN, shownSetpoint - 1))}
            >
              <Minus aria-hidden />
            </Button>
            <span className="w-14 text-center font-semibold tabular-nums">{shownSetpoint} °C</span>
            <Button
              variant="outline"
              size="icon"
              disabled={disabled || shownSetpoint >= SETPOINT_MAX}
              aria-label={t('assets.actions.increase')}
              onClick={() => setSetpoint(Math.min(SETPOINT_MAX, shownSetpoint + 1))}
            >
              <Plus aria-hidden />
            </Button>
            <Button
              size="sm"
              disabled={disabled || setpoint === null || setpoint === liveSetpoint}
              onClick={() =>
                command.mutate({ method: 'setSetpoint', params: { setpoint_c: shownSetpoint } })
              }
            >
              {t('assets.actions.apply')}
            </Button>
          </div>
        </div>
      )}

      {command.isError && (
        <Alert variant="destructive" data-testid="command-error">
          <AlertDescription>
            {isApiError(command.error)
              ? command.error.status === 403
                ? t('assets.actions.denied', { detail: command.error.detail ?? '' })
                : (command.error.detail ?? command.error.title)
              : String(command.error)}
          </AlertDescription>
        </Alert>
      )}

      {last && (
        <div className="rounded-md bg-muted/60 px-3 py-2 text-xs" data-testid="command-result">
          <div className="flex items-center gap-2">
            <Badge variant={last.result === 'SENT' ? 'success' : 'destructive'}>
              {last.result}
            </Badge>
            <span className="font-mono" dir="ltr">
              {last.method} {JSON.stringify(last.params)}
            </span>
          </div>
          <div className="mt-1 text-muted-foreground">
            {formatDateTime(last.sentAt, i18n.language, timeZone)}
            {last.error ? ` · ${last.error}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}
