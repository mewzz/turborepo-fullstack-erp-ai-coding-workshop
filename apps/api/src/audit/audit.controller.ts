import { Controller } from '@nestjs/common';
import { contract, type AuditLogEntry } from '@erp/contracts';
import { Implement, implement } from '@orpc/nest';
import { Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';

/** An `AuditLog` row with its actor joined in for display. */
type AuditRow = {
  id: string;
  actorId: string;
  action: string;
  sourceDocument: string;
  outcome: 'SUCCESS' | 'FAILURE';
  createdAt: Date;
  actor: { name: string };
};

function toEntry(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    actorId: row.actorId,
    actorName: row.actor.name,
    action: row.action,
    sourceDocument: row.sourceDocument,
    outcome: row.outcome,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The audit-log read API (NFR-03). Read access is restricted by permission: only a manager or an
 * administrator may see the trail. The log is append-only, so there is no write route here — audit
 * rows are written by the actions they record (e.g. a stock adjustment), never through this module.
 */
@Controller()
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles('MANAGER', 'ADMINISTRATOR')
  @Implement(contract.audit.list)
  list() {
    return implement(contract.audit.list).handler(async () => {
      const rows = await this.prisma.auditLog.findMany({
        include: { actor: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(toEntry);
    });
  }
}
