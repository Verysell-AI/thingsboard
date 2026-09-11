import type { Step, StepInputs } from './types.js';
import { DEFAULT_POWER_FACTOR, MAINS_VOLTAGE_V, clamp, jitter, round } from './types.js';

export interface AcState {
  on: 0 | 1;
  setpointC: number;
  roomTempC: number;
  nominalPowerW: number;
  nominalCurrentA: number;
  /** Cumulative running hours. */
  runtimeH: number;
  /** When true, current rises ~1% per hour at constant output (clogged filter). */
  filterDegrading: boolean;
  /** Current multiplier; 1.0 for a healthy unit. */
  degradeFactor: number;
  /** Last computed electrical power, in watts. */
  powerW: number;
}

export interface AcInputs extends StepInputs {
  /** Ambient temperature the room drifts towards when the AC is off. */
  ambientC?: number;
}

export const AC_DEFAULT_SETPOINT_C = 23;
export const AC_AMBIENT_C = 29;
/** Degrade rate per hour when filterDegrading is true. */
export const AC_DEGRADE_PER_HOUR = 0.01;

export function initialAcState(
  nominalPowerW: number,
  nominalCurrentA: number,
  opts: Partial<Pick<AcState, 'on' | 'setpointC' | 'roomTempC' | 'filterDegrading'>> = {},
): AcState {
  return {
    on: opts.on ?? 0,
    setpointC: opts.setpointC ?? AC_DEFAULT_SETPOINT_C,
    roomTempC: opts.roomTempC ?? 26,
    nominalPowerW,
    nominalCurrentA,
    runtimeH: 0,
    filterDegrading: opts.filterDegrading ?? false,
    degradeFactor: 1,
    powerW: 0,
  };
}

/**
 * Cooling output depends on the gap between room temperature and setpoint: full power while more
 * than 1 °C above setpoint, 45 % once settled (compressor cycling averaged out).
 */
export const stepAc: Step<AcState, AcInputs> = (state, { dt, rand, ambientC = AC_AMBIENT_C }) => {
  const hours = dt / 3600;
  let roomTempC = state.roomTempC;
  let powerW = 0;
  let runtimeH = state.runtimeH;
  let degradeFactor = state.degradeFactor;

  if (state.on) {
    const gap = roomTempC - state.setpointC;
    const load = gap > 1 ? 1 : gap > 0 ? 0.45 + 0.55 * gap : 0.45;
    powerW = jitter(state.nominalPowerW * load, 0.03, rand);
    // cool towards the setpoint at up to 2 °C per 10 minutes
    roomTempC = Math.max(state.setpointC, roomTempC - 2 * (dt / 600) * load);
    runtimeH += hours;
    if (state.filterDegrading) degradeFactor += AC_DEGRADE_PER_HOUR * hours;
  } else {
    // warm towards ambient at 0.5 °C per 10 minutes
    roomTempC = Math.min(ambientC, roomTempC + 0.5 * (dt / 600));
  }

  const current_a = (powerW / MAINS_VOLTAGE_V / DEFAULT_POWER_FACTOR) * degradeFactor;
  const next: AcState = {
    ...state,
    roomTempC: clamp(roomTempC, 16, 35),
    runtimeH,
    degradeFactor,
    powerW,
  };
  return {
    state: next,
    telemetry: {
      state: state.on,
      setpoint_c: state.setpointC,
      room_temp_c: round(roomTempC, 1),
      power_w: round(powerW, 1),
      current_a: round(current_a, 2),
      runtime_h: round(runtimeH, 2),
    },
  };
};

export function acPowerW(state: AcState): number {
  return state.on ? state.powerW || state.nominalPowerW * 0.45 : 0;
}
