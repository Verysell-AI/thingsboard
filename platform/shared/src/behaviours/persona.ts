import type { Persona, PersonaKey } from '../dataset/schema.js';
import { DEFAULT_TIME_ZONE, zonedDateParts } from '../clock.js';

export function parseHHMM(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Whether the persona is at work at the given minute of a weekday. */
export function personaAtWork(persona: Persona, minute: number, weekend: boolean): boolean {
  if (weekend || persona.arrive === null || persona.leave === null) return false;
  return minute >= parseHHMM(persona.arrive) && minute < parseHHMM(persona.leave);
}

/**
 * Whether the persona is at work at an instant, read as wall-clock time in the given zone. `now`
 * is the tenant's business clock (real or virtual), never the process clock.
 */
export function isAtWork(
  persona: Persona,
  now: number | Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): boolean {
  const p = zonedDateParts(typeof now === 'number' ? now : now.getTime(), timeZone);
  return personaAtWork(persona, p.hour * 60 + p.minute, p.weekday === 0 || p.weekday === 6);
}

export function findPersona(personas: Persona[], key: PersonaKey): Persona {
  const p = personas.find((x) => x.key === key);
  if (!p) throw new Error(`unknown persona ${key}`);
  return p;
}
