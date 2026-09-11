import { describe, expect, it } from 'vitest';
import { auditConditions, csvCell } from './audit-query.service.js';

describe('audit query', () => {
  it('builds one condition per filter and treats a trailing dot as a prefix', () => {
    expect(auditConditions({})).toHaveLength(0);
    expect(
      auditConditions({
        actor: 'ops',
        action: 'command.',
        entityType: 'asset',
        from: '2026-09-01T00:00:00Z',
        to: 'not a date',
      }),
    ).toHaveLength(4);
    expect(auditConditions({ action: 'DENIED', entityId: 'x' })).toHaveLength(2);
  });
  it('quotes CSV cells and serialises objects', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell({ state: 1 })).toBe('"{""state"":1}"');
    expect(csvCell(null)).toBe('');
  });
});
