import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller.js';
import { StockAdjustmentService } from './stock-adjustment.service.js';
import { StockMovementService } from './stock-movement.service.js';

/**
 * The inventory integrity spine: stock search plus the reusable movement/balance primitive that
 * goods receiving and sales build on. `StockMovementService` is exported so the sibling transaction
 * modules can inject it. `StockAdjustmentService` layers the manager correction + audit trail on
 * top of that primitive (INV-05, NFR-03).
 */
@Module({
  controllers: [InventoryController],
  providers: [StockMovementService, StockAdjustmentService],
  exports: [StockMovementService],
})
export class InventoryModule {}
