import { Injectable } from '@nestjs/common';
import type { AdjustStockInput, AdjustStockResult, User } from '@erp/contracts';
import { ORPCError } from '@orpc/nest';
import { PrismaService } from '../database/prisma.service.js';
import { MOVEMENT_MESSAGES, StockMovementService } from './stock-movement.service.js';

/** The action name recorded on every stock-adjustment audit entry (NFR-03). */
const ADJUSTMENT_ACTION = 'STOCK_ADJUSTMENT';

/** True when the primitive rejected the movement because it would drive the balance negative. */
function isOverReduction(error: unknown): boolean {
  return error instanceof ORPCError && error.message === MOVEMENT_MESSAGES.negative;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: StockMovementService,
  ) {}

  async adjust(input: AdjustStockInput, actor: User): Promise<AdjustStockResult> {
    const delta = input.direction === 'INCREASE' ? input.quantity : -input.quantity;
    const sourceDocument = `ADJ-${Date.now()}`;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const result = await this.movements.postMovement(
          {
            productId: input.productId,
            storeId: input.storeId,
            delta,
            type: 'ADJUSTMENT',
            // The mandatory reason travels with the ledger row as its source document (INV-05).
            sourceDocument: `${sourceDocument}: ${input.reason}`,
            actorId: actor.id,
          },
          tx,
        );

        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: ADJUSTMENT_ACTION,
            sourceDocument: `${sourceDocument}: ${input.reason}`,
            outcome: 'SUCCESS',
          },
        });

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
      if (isOverReduction(error)) {
        await this.prisma.auditLog.create({
          data: {
            actorId: actor.id,
            action: ADJUSTMENT_ACTION,
            sourceDocument: `${sourceDocument}: ${input.reason}`,
            outcome: 'FAILURE',
          },
        });
      }
      throw error;
    }
  }
}
