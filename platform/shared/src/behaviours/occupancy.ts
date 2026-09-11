import type { Step, StepInputs } from './types.js';

export interface OccupancyState {
  occupied: 0 | 1;
  count: number;
}

export interface OccupancyInputs extends StepInputs {
  /** People the sensor should see right now (from bookings and personas). */
  presentCount: number;
}

export function initialOccupancyState(): OccupancyState {
  return { occupied: 0, count: 0 };
}

export const stepOccupancy: Step<OccupancyState, OccupancyInputs> = (_state, { presentCount }) => {
  const count = Math.max(0, Math.round(presentCount));
  const state: OccupancyState = { occupied: count > 0 ? 1 : 0, count };
  return { state, telemetry: { occupied: state.occupied, count } };
};
