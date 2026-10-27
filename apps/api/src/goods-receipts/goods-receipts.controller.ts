import { Controller } from '@nestjs/common';
import { contract, type User } from '@erp/contracts';
import { Implement, implement } from '@orpc/nest';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { GoodsReceiptService } from './goods-receipt.service.js';

/**
 * The goods-receiving API (T6). Confirming is for a `STORE_EMPLOYEE` only; the service then checks
 * the employee is assigned to the order's destination store, because the store is not a route
 * param or body field `@StoreScoped` could read. Reads are open to any signed-in user and the
 * service narrows a store employee to their own store. There is no edit or cancel route (GR-05).
 */
@Controller()
export class GoodsReceiptsController {
  constructor(private readonly receipts: GoodsReceiptService) {}

  @Implement(contract.goodsReceipts.summary)
  summary(@CurrentUser() user: User) {
    return implement(contract.goodsReceipts.summary).handler(({ input }) =>
      this.receipts.summary(input.purchaseOrderId, user),
    );
  }

  @Roles('STORE_EMPLOYEE')
  @Implement(contract.goodsReceipts.receive)
  receive(@CurrentUser() user: User) {
    return implement(contract.goodsReceipts.receive).handler(({ input }) =>
      this.receipts.receive(input, user),
    );
  }

  @Implement(contract.goodsReceipts.listForOrder)
  listForOrder(@CurrentUser() user: User) {
    return implement(contract.goodsReceipts.listForOrder).handler(({ input }) =>
      this.receipts.listForOrder(input.purchaseOrderId, user),
    );
  }

  @Implement(contract.goodsReceipts.get)
  get(@CurrentUser() user: User) {
    return implement(contract.goodsReceipts.get).handler(({ input }) =>
      this.receipts.get(input.id, user),
    );
  }
}
