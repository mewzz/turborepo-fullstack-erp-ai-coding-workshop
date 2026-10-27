import { Controller } from '@nestjs/common';
import { contract, type User } from '@erp/contracts';
import { Implement, implement } from '@orpc/nest';
import { CurrentUser, Roles, StoreScoped } from '../auth/auth.decorators.js';
import { SaleService } from './sale.service.js';

/**
 * The sales API (T7). Recording and confirming sales are for a `STORE_EMPLOYEE`, scoped to their
 * assigned store: `create` reads the target store from the body, and the service re-checks the
 * store on confirm (the store id lives on the stored sale, not the request). Listing and getting
 * are store-scoped inside the service so an employee sees only their own store's sales.
 */
@Controller()
export class SalesController {
  constructor(private readonly sales: SaleService) {}

  @Implement(contract.sales.list)
  list(@CurrentUser() user: User) {
    return implement(contract.sales.list).handler(() => this.sales.list(user));
  }

  @Implement(contract.sales.get)
  get(@CurrentUser() user: User) {
    return implement(contract.sales.get).handler(({ input }) => this.sales.get(input.id, user));
  }

  @Roles('STORE_EMPLOYEE')
  @StoreScoped('storeId')
  @Implement(contract.sales.create)
  create(@CurrentUser() user: User) {
    return implement(contract.sales.create).handler(({ input }) => this.sales.create(input, user));
  }

  @Roles('STORE_EMPLOYEE')
  @Implement(contract.sales.confirm)
  confirm(@CurrentUser() user: User) {
    return implement(contract.sales.confirm).handler(({ input }) =>
      this.sales.confirm(input, user),
    );
  }
}
