import { Controller } from '@nestjs/common';
import { contract } from '@erp/contracts';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { Roles } from '../auth/auth.decorators.js';
import { mapWriteErrors } from '../database/prisma-errors.js';
import { PrismaService } from '../database/prisma.service.js';

const MESSAGES = {
  conflict: 'รหัสผู้จัดจำหน่ายนี้มีอยู่แล้ว',
  notFound: 'ไม่พบผู้จัดจำหน่าย',
};

@Controller()
export class SuppliersController {
  constructor(private readonly prisma: PrismaService) {}

  @Implement(contract.suppliers.list)
  list() {
    return implement(contract.suppliers.list).handler(() =>
      this.prisma.supplier.findMany({ orderBy: { code: 'asc' } }),
    );
  }

  @Implement(contract.suppliers.get)
  get() {
    return implement(contract.suppliers.get).handler(async ({ input }) => {
      const supplier = await this.prisma.supplier.findUnique({ where: { id: input.id } });
      if (!supplier) throw new ORPCError('NOT_FOUND', { message: MESSAGES.notFound });
      return supplier;
    });
  }

  @Roles('ADMINISTRATOR')
  @Implement(contract.suppliers.create)
  create() {
    return implement(contract.suppliers.create).handler(({ input }) =>
      mapWriteErrors(() => this.prisma.supplier.create({ data: input }), MESSAGES),
    );
  }

  @Roles('ADMINISTRATOR')
  @Implement(contract.suppliers.update)
  update() {
    return implement(contract.suppliers.update).handler(({ input }) => {
      const { id, ...data } = input;
      return mapWriteErrors(() => this.prisma.supplier.update({ where: { id }, data }), MESSAGES);
    });
  }
}
