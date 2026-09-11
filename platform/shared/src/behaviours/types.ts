import type { TelemetryValues } from '../contracts/mqtt.js';

/** Inputs common to every step. Behaviours are pure: same state + inputs give the same output. */
export interface StepInputs {
  /** Current time in ms since epoch (real or synthetic). */
  now: number;
  /** Seconds elapsed since the previous step. */
  dt: number;
  /** Deterministic random source in [0, 1). */
  rand: () => number;
}

export interface StepResult<S> {
  state: S;
  telemetry: TelemetryValues;
}

export type Step<S, I extends StepInputs = StepInputs> = (state: S, inputs: I) => StepResult<S>;

export const MAINS_VOLTAGE_V = 230;
export const DEFAULT_POWER_FACTOR = 0.92;

/** Adds energy for `powerW` sustained over `dtSeconds`; never decreases. */
export function integrateKwh(energyKwh: number, powerW: number, dtSeconds: number): number {
  if (!(dtSeconds > 0) || !(powerW > 0)) return energyKwh;
  return energyKwh + (powerW * dtSeconds) / 3_600_000;
}

/** Multiplies by a factor in [1 - pct, 1 + pct]. */
export function jitter(value: number, pct: number, rand: () => number): number {
  return value * (1 + (rand() * 2 - 1) * pct);
}

export function round(value: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Small deterministic PRNG (mulberry32) so shared has no dependency on seedrandom. */
export function createRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
