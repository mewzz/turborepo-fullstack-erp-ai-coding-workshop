import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { SaleService } from './sale.service.js';
import { SalesController } from './sales.controller.js';

/**
 * The sales module (T7). Imports `InventoryModule` for the shared `StockMovementService` so
 * confirmation can decrease stock through the ledger primitive.
 */
@Module({
  imports: [InventoryModule],
  controllers: [SalesController],
  providers: [SaleService],
})
export class SalesModule {}
