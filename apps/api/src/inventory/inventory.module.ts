import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller.js';
import { StockMovementService } from './stock-movement.service.js';

/**
 * The inventory integrity spine: stock search plus the reusable movement/balance primitive that
 * goods receiving and sales build on. `StockMovementService` is exported so the sibling transaction
 * modules can inject it.
 */
@Module({
  controllers: [InventoryController],
  providers: [StockMovementService],
  exports: [StockMovementService],
})
export class InventoryModule {}
