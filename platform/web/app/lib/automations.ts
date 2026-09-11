import {
  AUTOMATION_PARAMS,
  type AutomationKey,
  type AutomationRun,
  type Decision,
} from '@platform/shared/dto';

/**
 * A form field derived from a Zod parameter schema, so the automations page renders the right
 * control for every key without a hand-written form per automation.
 */
export type ParamField =
  | { key: string; kind: 'number'; min?: number; max?: number; integer: boolean; default?: number }
  | { key: string; kind: 'time'; default?: string }
  | { key: string; kind: 'timeRange'; default?: string }
  | { key: string; kind: 'enumList'; options: string[]; default?: string[] }
  | { key: string; kind: 'dateList'; default?: string[] }
  | { key: string; kind: 'text'; default?: string };

interface ZodDefLike {
  type?: string;
  innerType?: ZodLike;
  defaultValue?: unknown;
  checks?: { _zod?: { def?: Record<string, unknown> } }[];
  element?: ZodLike;
  entries?: Record<string, string>;
}
interface ZodLike {
  def?: ZodDefLike;
  shape?: Record<string, ZodLike>;
}

const TIME_RE = /\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d/;
const DATE_RE = /\\d\{4\}-\\d\{2\}-\\d\{2\}/;

/** Unwraps default/optional/nullable wrappers, remembering the default value. */
function unwrap(schema: ZodLike): { inner: ZodLike; defaultValue: unknown } {
  let current = schema;
  let defaultValue: unknown;
  for (let i = 0; i < 5; i++) {
    const def = current.def;
    if (!def) break;
    if (def.type === 'default' && def.innerType) {
      if (defaultValue === undefined) defaultValue = def.defaultValue;
      current = def.innerType;
      continue;
    }
    if ((def.type === 'optional' || def.type === 'nullable') && def.innerType) {
      current = def.innerType;
      continue;
    }
    break;
  }
  return { inner: current, defaultValue };
}

function checksOf(schema: ZodLike): Record<string, unknown>[] {
  return (schema.def?.checks ?? []).map((c) => c._zod?.def ?? {});
}

function patternsOf(schema: ZodLike): string[] {
  return checksOf(schema)
    .filter((c) => c.check === 'string_format' && c.format === 'regex')
    .map((c) => String(c.pattern));
}

export function paramFields(key: AutomationKey): ParamField[] {
  const schema = AUTOMATION_PARAMS[key] as unknown as ZodLike;
  const shape = schema.shape ?? {};
  return Object.entries(shape).map(([name, field]) => {
    const { inner, defaultValue } = unwrap(field);
    const type = inner.def?.type;
    if (type === 'number') {
      const checks = checksOf(inner);
      let min: number | undefined;
      let max: number | undefined;
      let integer = false;
      for (const c of checks) {
        if (c.check === 'greater_than' && typeof c.value === 'number')
          min = c.inclusive ? c.value : c.value + Number.EPSILON;
        if (c.check === 'less_than' && typeof c.value === 'number') max = c.value;
        if (c.check === 'number_format') integer = true;
      }
      return {
        key: name,
        kind: 'number',
        min,
        max,
        integer,
        default: typeof defaultValue === 'number' ? defaultValue : undefined,
      };
    }
    if (type === 'string') {
      const patterns = patternsOf(inner);
      const d = typeof defaultValue === 'string' ? defaultValue : undefined;
      if (patterns.some((p) => TIME_RE.test(p) && p.split(':').length > 2))
        return { key: name, kind: 'timeRange', default: d };
      if (patterns.some((p) => TIME_RE.test(p))) return { key: name, kind: 'time', default: d };
      return { key: name, kind: 'text', default: d };
    }
    if (type === 'array') {
      const element = inner.def?.element ? unwrap(inner.def.element).inner : undefined;
      const d = Array.isArray(defaultValue) ? (defaultValue as string[]) : undefined;
      if (element?.def?.type === 'enum' && element.def.entries) {
        return {
          key: name,
          kind: 'enumList',
          options: Object.keys(element.def.entries),
          default: d,
        };
      }
      if (element?.def?.type === 'string' && patternsOf(element).some((p) => DATE_RE.test(p))) {
        return { key: name, kind: 'dateList', default: d };
      }
      return { key: name, kind: 'text', default: d?.join(', ') };
    }
    return { key: name, kind: 'text', default: undefined };
  });
}

/** Converts form values (strings from inputs) into the JSON the API validates. */
export function paramsFromForm(
  fields: ParamField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined || v === '') continue;
    if (f.kind === 'number') {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) out[f.key] = n;
    } else out[f.key] = v;
  }
  return out;
}

export interface RunSummaryView {
  businessTime: number | null;
  trigger: string | null;
  roomsOff: string[];
  roomsSkipped: { room: string; reason: string }[];
  commandsSent: number;
  released: number;
  decisions: Decision[];
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Reads the loosely typed run summary into a fixed shape the pages can render. */
export function summarizeRun(run: Pick<AutomationRun, 'summary' | 'trigger'>): RunSummaryView {
  const s = run.summary ?? {};
  const roomsOff = Array.isArray(s.roomsOff) ? s.roomsOff.map(String) : [];
  const roomsSkipped = Array.isArray(s.roomsSkipped)
    ? (s.roomsSkipped as unknown[]).flatMap((x) =>
        x && typeof x === 'object' && 'room' in x
          ? [
              {
                room: String((x as { room: unknown }).room),
                reason: String((x as { reason?: unknown }).reason ?? ''),
              },
            ]
          : [],
      )
    : [];
  const decisions = Array.isArray(s.decisions) ? (s.decisions as Decision[]) : [];
  const commandsFromDecisions = decisions.filter((d) => d.kind === 'command').length;
  const releasedFromDecisions = decisions.filter((d) => d.kind === 'release_booking').length;
  return {
    businessTime: num(s.businessTime),
    trigger: typeof s.trigger === 'string' ? s.trigger : (run.trigger ?? null),
    roomsOff,
    roomsSkipped,
    commandsSent: num(s.commandsSent) ?? commandsFromDecisions,
    released: num(s.released) ?? releasedFromDecisions,
    decisions,
  };
}

/** Whether a room card should carry the waste badge. */
export function isWasting(room: { wastingSinceMinutes: number | null }): boolean {
  return room.wastingSinceMinutes !== null && room.wastingSinceMinutes > 0;
}
