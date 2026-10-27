import { oc } from '@orpc/contract';
import * as z from 'zod';

/**
 * The outcome of an auditable action (NFR-03). `SUCCESS` for an action that committed, `FAILURE`
 * for one that was rejected (e.g. an over-reduction). Append-only either way: a rejected attempt is
 * still a record someone may need to see.
 */
export const AuditOutcomeSchema = z.enum(['SUCCESS', 'FAILURE']);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

/**
 * One append-only audit record (NFR-03): who did what, when, against which source document, and
 * whether it succeeded. The first auditable event is a manager stock adjustment (INV-05); the shape
 * is general so later auditable actions reuse it. Read access is restricted by permission.
 */
export const AuditLogEntrySchema = z.object({
  id: z.string(),
  /** The user who performed the action. */
  actorId: z.string(),
  /** The actor's name at read time, joined in for display. */
  actorName: z.string().min(1),
  /** A machine-readable action name, e.g. "STOCK_ADJUSTMENT". */
  action: z.string().min(1),
  /** The document the action acted on, e.g. a stock-adjustment reference. Free text. */
  sourceDocument: z.string().min(1),
  outcome: AuditOutcomeSchema,
  /** When the action happened, ISO 8601. */
  createdAt: z.string(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const auditContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/audit-log',
      summary: 'List audit-log entries, most recent first (read-restricted, NFR-03)',
      tags: ['Audit'],
    })
    .output(z.array(AuditLogEntrySchema)),
};
