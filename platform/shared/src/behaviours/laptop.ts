import type { Step, StepInputs } from './types.js';
import { clamp, round } from './types.js';

export interface LaptopState {
  battery: number;
  cpu: number;
  user: string;
  /** Access point id currently seen, or null when offline. */
  ap: string | null;
  charging: boolean;
}

export interface LaptopInputs extends StepInputs {
  /** Access point the laptop is connected to for this step. */
  ap: string;
  /** Whether the laptop is plugged in (at its desk). */
  docked: boolean;
}

export function initialLaptopState(user: string, battery = 80): LaptopState {
  return { battery, cpu: 10, user, ap: null, charging: false };
}

/** Battery drifts up while docked, down otherwise; CPU is a bounded random walk. */
export const stepLaptop: Step<LaptopState, LaptopInputs> = (state, { dt, rand, ap, docked }) => {
  const hours = dt / 3600;
  const battery = clamp(docked ? state.battery + 25 * hours : state.battery - 12 * hours, 5, 100);
  const cpu = clamp(state.cpu + (rand() * 2 - 1) * 15, 2, 95);
  const next: LaptopState = { ...state, battery, cpu, ap, charging: docked };
  return {
    state: next,
    telemetry: { battery: round(battery, 0), cpu: round(cpu, 0), user: state.user, ap },
  };
};
