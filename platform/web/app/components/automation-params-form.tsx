import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import type { ParamField } from '~/lib/automations';

export type ParamValues = Record<string, unknown>;

/** Renders one control per derived field; the caller owns the values and saves them. */
export function AutomationParamsForm({
  automationKey,
  fields,
  values,
  onChange,
  disabled,
}: {
  automationKey: string;
  fields: ParamField[];
  values: ParamValues;
  onChange: (next: ParamValues) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const id = `${automationKey}-${f.key}`;
        const label = t(`automations.params.${f.key}`, { defaultValue: f.key });
        switch (f.kind) {
          case 'number':
            return (
              <div key={f.key} className="flex flex-col gap-1">
                <Label htmlFor={id}>{label}</Label>
                <Input
                  id={id}
                  type="number"
                  inputMode={f.integer ? 'numeric' : 'decimal'}
                  step={f.integer ? 1 : 'any'}
                  min={f.min}
                  max={f.max}
                  disabled={disabled}
                  value={values[f.key] === undefined ? '' : String(values[f.key])}
                  onChange={(e) => set(f.key, e.target.value)}
                  dir="ltr"
                />
              </div>
            );
          case 'time':
            return (
              <div key={f.key} className="flex flex-col gap-1">
                <Label htmlFor={id}>{label}</Label>
                <Input
                  id={id}
                  type="time"
                  disabled={disabled}
                  value={String(values[f.key] ?? '')}
                  onChange={(e) => set(f.key, e.target.value)}
                  dir="ltr"
                />
              </div>
            );
          case 'timeRange': {
            const [from = '', to = ''] = String(values[f.key] ?? '').split('-');
            return (
              <div key={f.key} className="flex flex-col gap-1">
                <Label htmlFor={`${id}-from`}>{label}</Label>
                <div className="flex items-center gap-2" dir="ltr">
                  <Input
                    id={`${id}-from`}
                    type="time"
                    disabled={disabled}
                    value={from}
                    onChange={(e) => set(f.key, `${e.target.value}-${to}`)}
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    id={`${id}-to`}
                    type="time"
                    aria-label={`${label} (${t('automations.until')})`}
                    disabled={disabled}
                    value={to}
                    onChange={(e) => set(f.key, `${from}-${e.target.value}`)}
                  />
                </div>
              </div>
            );
          }
          case 'enumList': {
            const selected = Array.isArray(values[f.key]) ? (values[f.key] as string[]) : [];
            const toggle = (opt: string) =>
              set(
                f.key,
                selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt],
              );
            const move = (opt: string, dir: -1 | 1) => {
              const i = selected.indexOf(opt);
              const j = i + dir;
              if (i < 0 || j < 0 || j >= selected.length) return;
              const next = [...selected];
              [next[i], next[j]] = [next[j]!, next[i]!];
              set(f.key, next);
            };
            const ordered = [...selected, ...f.options.filter((o) => !selected.includes(o))];
            return (
              <fieldset key={f.key} className="flex flex-col gap-1 sm:col-span-2">
                <legend className="text-sm font-medium">{label}</legend>
                <ol className="flex flex-col gap-1 rounded-md border p-2">
                  {ordered.map((opt) => {
                    const on = selected.includes(opt);
                    return (
                      <li key={opt} className="flex items-center gap-2 text-sm">
                        <input
                          id={`${id}-${opt}`}
                          type="checkbox"
                          checked={on}
                          disabled={disabled}
                          onChange={() => toggle(opt)}
                        />
                        <label htmlFor={`${id}-${opt}`} className="flex-1">
                          {on ? `${selected.indexOf(opt) + 1}. ` : ''}
                          {t(`automations.options.${opt}`, { defaultValue: opt })}
                        </label>
                        {on && (
                          <span className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={disabled}
                              aria-label={t('automations.moveUp')}
                              onClick={() => move(opt, -1)}
                            >
                              ↑
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={disabled}
                              aria-label={t('automations.moveDown')}
                              onClick={() => move(opt, 1)}
                            >
                              ↓
                            </Button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </fieldset>
            );
          }
          case 'dateList': {
            const dates = Array.isArray(values[f.key]) ? (values[f.key] as string[]) : [];
            return (
              <fieldset key={f.key} className="flex flex-col gap-1 sm:col-span-2">
                <legend className="text-sm font-medium">{label}</legend>
                <ul className="flex flex-wrap gap-2">
                  {dates.map((d, i) => (
                    <li key={`${d}-${i}`} className="flex items-center gap-1">
                      <Input
                        type="date"
                        aria-label={`${label} ${i + 1}`}
                        disabled={disabled}
                        value={d}
                        onChange={(e) =>
                          set(
                            f.key,
                            dates.map((x, j) => (j === i ? e.target.value : x)),
                          )
                        }
                        className="w-40"
                        dir="ltr"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={disabled}
                        aria-label={t('automations.removeDate')}
                        onClick={() =>
                          set(
                            f.key,
                            dates.filter((_, j) => j !== i),
                          )
                        }
                      >
                        <X aria-hidden />
                      </Button>
                    </li>
                  ))}
                  <li>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() => set(f.key, [...dates, ''])}
                    >
                      <Plus aria-hidden /> {t('automations.addDate')}
                    </Button>
                  </li>
                </ul>
              </fieldset>
            );
          }
          default:
            return (
              <div key={f.key} className="flex flex-col gap-1">
                <Label htmlFor={id}>{label}</Label>
                <Input
                  id={id}
                  disabled={disabled}
                  value={String(values[f.key] ?? '')}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </div>
            );
        }
      })}
    </div>
  );
}
