import { Controller } from '@nestjs/common';
import { contract } from '@erp/contracts';
import { Implement, implement } from '@orpc/nest';
import { PrismaService } from '../database/prisma.service.js';

/** Read-only store directory so other modules (e.g. purchase orders) can offer a store picker. */
@Controller()
export class StoresController {
  constructor(private readonly prisma: PrismaService) {}

  @Implement(contract.stores.list)
  list() {
    return implement(contract.stores.list).handler(() =>
      this.prisma.store.findMany({
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
    );
  }
}
