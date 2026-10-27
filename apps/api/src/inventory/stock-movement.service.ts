import { Injectable } from '@nestjs/common';
import type { MovementType } from '@erp/contracts';
import { ORPCError } from '@orpc/nest';
import { isUniqueViolation } from '../database/prisma-errors.js';
import { PrismaService } from '../database/prisma.service.js';

/** The actor, document and change a single movement records. */
export interface PostMovementInput {
  productId: string;
  storeId: string;
  /** Signed whole-unit change: positive for stock in, negative for stock out. */
  delta: number;
  type: MovementType;
  /** The document the movement is posted from, e.g. "GR-0001". */
  sourceDocument: string;
  /** The user confirming the movement (INV-02 actor). */
  actorId: string;
  /**
   * The per-store reorder threshold to set when this movement opens a new balance (MD-01). Ignored
   * once a balance exists. Omitted means 0, matching the `StockBalance.reorderThreshold` default.
   */
  reorderThreshold?: number;
}

/** The ledger row plus the balance it produced, returned to the caller that posted it. */
export interface PostMovementResult {
  movementId: string;
  balanceBefore: number;
  balanceAfter: number;
}

/** oRPC error messages this primitive throws. Exported so callers can tell the two CONFLICTs apart. */
export const MOVEMENT_MESSAGES = {
  negative: 'สต็อกคงเหลือติดลบไม่ได้',
  conflict: 'สต็อกถูกแก้ไขโดยรายการอื่น กรุณาลองใหม่',
};
const MESSAGES = MOVEMENT_MESSAGES;

/** The subset of the Prisma client the primitive touches, so a caller can pass an open transaction. */
type MovementTx = Pick<PrismaService, 'stockBalance' | 'stockMovement'>;

/**
 * The integrity spine every transaction module reuses (INV-02, INV-03, INV-04).
 *
 * `postMovement` writes one append-only `StockMovement` and updates the derived `StockBalance`
 * together in a single transaction, or rolls both back. It rejects any change that would drive the
 * balance negative, and it updates the balance under an optimistic-lock version check so a
 * concurrent confirm that read a stale balance loses the race instead of overwriting it.
 *
 * A caller that must write more rows atomically with the movement (e.g. a manager adjustment that
 * also appends an audit entry) passes its own open transaction as `tx`; the primitive then joins
 * that transaction instead of opening its own, so everything commits or rolls back together.
 */
@Injectable()
export class StockMovementService {
  constructor(private readonly prisma: PrismaService) {}

  async postMovement(input: PostMovementInput, tx?: MovementTx): Promise<PostMovementResult> {
    if (tx) return this.post(tx, input);
    return this.prisma.$transaction((transaction) => this.post(transaction, input));
  }

  private async post(tx: MovementTx, input: PostMovementInput): Promise<PostMovementResult> {
    const balance = await tx.stockBalance.findUnique({
      where: { productId_storeId: { productId: input.productId, storeId: input.storeId } },
    });

    const balanceBefore = balance?.quantity ?? 0;
    const balanceAfter = balanceBefore + input.delta;
    if (balanceAfter < 0) {
      throw new ORPCError('CONFLICT', { message: MESSAGES.negative });
    }

    const movement = await tx.stockMovement.create({
      data: {
        productId: input.productId,
        storeId: input.storeId,
        delta: input.delta,
        balanceBefore,
        balanceAfter,
        type: input.type,
        sourceDocument: input.sourceDocument,
        actorId: input.actorId,
      },
    });

    if (balance) {
      // Optimistic lock: the update only matches while the version is unchanged. A concurrent
      // writer that already bumped it leaves zero rows affected, and we lose the race (INV-04).
      const updated = await tx.stockBalance.updateMany({
        where: { id: balance.id, version: balance.version },
        data: { quantity: balanceAfter, version: balance.version + 1 },
      });
      if (updated.count === 0) {
        throw new ORPCError('CONFLICT', { message: MESSAGES.conflict });
      }
    } else {
      // No cache row yet: this movement opens the balance for the pair. The unique (product,
      // store) constraint is the lock here: if a concurrent first movement created the row
      // between our read and this write, the create violates it and we lose the race (INV-04).
      try {
        await tx.stockBalance.create({
          data: {
            productId: input.productId,
            storeId: input.storeId,
            quantity: balanceAfter,
            reorderThreshold: input.reorderThreshold ?? 0,
            version: 0,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ORPCError('CONFLICT', { message: MESSAGES.conflict });
        }
        throw error;
      }
    }

    return { movementId: movement.id, balanceBefore, balanceAfter };
  }
}
