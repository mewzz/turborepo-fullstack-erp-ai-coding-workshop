import { Module } from '@nestjs/common';
import { PurchaseOrderService } from './purchase-order.service.js';
import { PurchaseOrdersController } from './purchase-orders.controller.js';

@Module({
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrderService],
})
export class PurchaseOrdersModule {}
