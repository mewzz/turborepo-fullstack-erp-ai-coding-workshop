import { describe, expect, it } from 'vitest';
import { AuditLogEntrySchema, AuditOutcomeSchema } from './audit.js';

const validEntry = {
  id: 'a1',
  actorId: 'u1',
  actorName: 'Manager One',
  action: 'STOCK_ADJUSTMENT',
  sourceDocument: 'ADJ-1700000000000',
  outcome: 'SUCCESS' as const,
  createdAt: new Date().toISOString(),
};

describe('AuditOutcomeSchema', () => {
  it('accepts SUCCESS and FAILURE', () => {
    expect(AuditOutcomeSchema.safeParse('SUCCESS').success).toBe(true);
    expect(AuditOutcomeSchema.safeParse('FAILURE').success).toBe(true);
  });

  it('rejects any other outcome', () => {
    expect(AuditOutcomeSchema.safeParse('PENDING').success).toBe(false);
  });
});

describe('AuditLogEntrySchema', () => {
  it('accepts a well-formed audit entry', () => {
    expect(AuditLogEntrySchema.safeParse(validEntry).success).toBe(true);
  });

  it('rejects an empty source document', () => {
    expect(AuditLogEntrySchema.safeParse({ ...validEntry, sourceDocument: '' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown outcome', () => {
    expect(AuditLogEntrySchema.safeParse({ ...validEntry, outcome: 'MAYBE' }).success).toBe(false);
  });
});
