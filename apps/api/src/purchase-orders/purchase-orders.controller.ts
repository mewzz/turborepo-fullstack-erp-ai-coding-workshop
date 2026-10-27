import { Controller } from '@nestjs/common';
import { contract, type User } from '@erp/contracts';
import { Implement, implement } from '@orpc/nest';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { PurchaseOrderService } from './purchase-order.service.js';

/**
 * The purchase-order lifecycle API (T5). Role is gated here where it is a hard requirement:
 * drafting and editing are for a `PURCHASING_OFFICER`, approving and rejecting for a `MANAGER`.
 * Submit and cancel allow either and delegate the authorship check to the service, which also runs
 * every status guard. No route posts a stock movement (PO-02).
 */
@Controller()
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrderService) {}

  @Implement(contract.purchaseOrders.list)
  list() {
    return implement(contract.purchaseOrders.list).handler(() => this.orders.list());
  }

  @Implement(contract.purchaseOrders.get)
  get() {
    return implement(contract.purchaseOrders.get).handler(({ input }) => this.orders.get(input.id));
  }

  @Roles('PURCHASING_OFFICER')
  @Implement(contract.purchaseOrders.create)
  create(@CurrentUser() user: User) {
    return implement(contract.purchaseOrders.create).handler(({ input }) =>
      this.orders.create(input, user),
    );
  }

  @Roles('PURCHASING_OFFICER')
  @Implement(contract.purchaseOrders.update)
  update(@CurrentUser() user: User) {
    return implement(contract.purchaseOrders.update).handler(({ input }) =>
      this.orders.update(input, user),
    );
  }

  @Roles('PURCHASING_OFFICER')
  @Implement(contract.purchaseOrders.submit)
  submit(@CurrentUser() user: User) {
    return implement(contract.purchaseOrders.submit).handler(({ input }) =>
      this.orders.transition('submit', input, user),
    );
  }

  @Roles('MANAGER')
  @Implement(contract.purchaseOrders.approve)
  approve(@CurrentUser() user: User) {
    return implement(contract.purchaseOrders.approve).handler(({ input }) =>
      this.orders.transition('approve', input, user),
    );
  }

  @Roles('MANAGER')
  @Implement(contract.purchaseOrders.reject)
  reject(@CurrentUser() user: User) {
    return implement(contract.purchaseOrders.reject).handler(({ input }) =>
      this.orders.transition('reject', input, user),
    );
  }

  @Roles('PURCHASING_OFFICER', 'MANAGER')
  @Implement(contract.purchaseOrders.cancel)
  cancel(@CurrentUser() user: User) {
    return implement(contract.purchaseOrders.cancel).handler(({ input }) =>
      this.orders.transition('cancel', input, user),
    );
  }
}
