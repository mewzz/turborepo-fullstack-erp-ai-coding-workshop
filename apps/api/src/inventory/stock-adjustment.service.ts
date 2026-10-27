import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { AdjustStockInput, AdjustStockResult, AuditOutcome, User } from '@erp/contracts';
import { ORPCError } from '@orpc/nest';
import { PrismaService } from '../database/prisma.service.js';
import { NEGATIVE_BALANCE_REASON, StockMovementService } from './stock-movement.service.js';

/** The action name recorded on every stock-adjustment audit entry (NFR-03). */
const ADJUSTMENT_ACTION = 'STOCK_ADJUSTMENT';

/** True when the primitive rejected the movement because it would drive the balance negative. */
function isOverReduction(error: unknown): boolean {
  return (
    error instanceof ORPCError &&
    typeof error.data === 'object' &&
    error.data !== null &&
    'reason' in error.data &&
    error.data.reason === NEGATIVE_BALANCE_REASON
  );
}

/**
 * Manager stock corrections (INV-05) and their audit trail (NFR-03).
 *
 * A successful adjustment writes the `ADJUSTMENT` movement (through the shared ledger primitive) and
 * a `SUCCESS` audit entry in one transaction, so a reader never sees a movement without its audit
 * record or the reverse. An over-reduction is rejected by the primitive — stock never goes negative
 * — and the rejection is still recorded as a `FAILURE` audit entry, since the attempt is itself
 * auditable. Both carry the same source document so the movement and its audit row describe one act.
 */
@Injectable()
export class StockAdjustmentService {
  private readonly logger = new Logger(StockAdjustmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: StockMovementService,
  ) {}

  async adjust(input: AdjustStockInput, actor: User): Promise<AdjustStockResult> {
    const delta = input.direction === 'INCREASE' ? input.quantity : -input.quantity;
    // One reference per attempt, carrying the mandatory reason, shared by the movement and its audit
    // entry. The random suffix keeps two adjustments in the same millisecond distinct.
    const sourceDocument = `ADJ-${randomUUID().slice(0, 8).toUpperCase()}: ${input.reason}`;
    const audit = (outcome: AuditOutcome) => ({
      actorId: actor.id,
      action: ADJUSTMENT_ACTION,
      sourceDocument,
      outcome,
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const result = await this.movements.postMovement(
          {
            productId: input.productId,
            storeId: input.storeId,
            delta,
            type: 'ADJUSTMENT',
            sourceDocument,
            actorId: actor.id,
          },
          tx,
        );

        await tx.auditLog.create({ data: audit('SUCCESS') });

        return {
          movementId: result.movementId,
          productId: input.productId,
          storeId: input.storeId,
          balanceBefore: result.balanceBefore,
          balanceAfter: result.balanceAfter,
        };
      });
    } catch (error) {
      // An over-reduction is a rejected but auditable attempt: record the failure outside the
      // rolled-back transaction, then surface the original rejection. Any other error (e.g. a
      // failed audit write) rolls everything back and propagates with nothing recorded.
      if (isOverReduction(error)) await this.recordFailure(audit('FAILURE'));
      throw error;
    }
  }

  /**
   * Append the FAILURE entry. If that write itself fails, log it and let the caller rethrow the
   * original rejection: the manager must see why the adjustment was refused, not an audit error.
   */
  private async recordFailure(data: {
    actorId: string;
    action: string;
    sourceDocument: string;
    outcome: AuditOutcome;
  }) {
    try {
      await this.prisma.auditLog.create({ data });
    } catch (auditError) {
      this.logger.error('Could not record the FAILURE audit entry', auditError);
    }
  }
}
