import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { GoodsReceiptService } from './goods-receipt.service.js';
import { GoodsReceiptsController } from './goods-receipts.controller.js';

@Module({
  imports: [InventoryModule],
  controllers: [GoodsReceiptsController],
  providers: [GoodsReceiptService],
})
export class GoodsReceiptsModule {}
