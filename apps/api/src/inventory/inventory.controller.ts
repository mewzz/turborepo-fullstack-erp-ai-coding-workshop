import { Controller } from '@nestjs/common';
import { contract, type StockSearchResult, type User } from '@erp/contracts';
import { Implement, implement } from '@orpc/nest';
import { CurrentUser } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';

/** The `StockBalance` row shape the search reads, with its product and store joined in. */
type BalanceRow = {
  productId: string;
  storeId: string;
  quantity: number;
  reorderThreshold: number;
  product: { sku: string; name: string; unit: string };
  store: { code: string };
};

/** Low-stock is inclusive: a balance at or below the per-store threshold is low (INV-01). */
function toSearchResult(row: BalanceRow): StockSearchResult {
  return {
    productId: row.productId,
    sku: row.product.sku,
    name: row.product.name,
    unit: row.product.unit,
    storeId: row.storeId,
    storeCode: row.store.code,
    quantity: row.quantity,
    reorderThreshold: row.reorderThreshold,
    lowStock: row.quantity <= row.reorderThreshold,
  };
}

@Controller()
export class InventoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Implement(contract.inventory.search)
  search(@CurrentUser() user: User) {
    return implement(contract.inventory.search).handler(async ({ input }) => {
      // A store employee sees their assigned store only (TOR §2); the requested store, if any,
      // narrows further but can never widen past it. Other roles see every store.
      const scopedStoreId =
        user.role === 'STORE_EMPLOYEE' && user.storeId ? user.storeId : input.storeId;

      const rows = await this.prisma.stockBalance.findMany({
        where: {
          ...(scopedStoreId ? { storeId: scopedStoreId } : {}),
          ...(input.query
            ? {
                product: {
                  OR: [
                    { sku: { contains: input.query, mode: 'insensitive' } },
                    { name: { contains: input.query, mode: 'insensitive' } },
                  ],
                },
              }
            : {}),
        },
        include: {
          product: { select: { sku: true, name: true, unit: true } },
          store: { select: { code: true } },
        },
        orderBy: [{ store: { code: 'asc' } }, { product: { sku: 'asc' } }],
      });

      return rows.map(toSearchResult);
    });
  }
}
