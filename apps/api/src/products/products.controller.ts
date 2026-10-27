import { Controller } from '@nestjs/common';
import { contract, type Product } from '@erp/contracts';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { Roles } from '../auth/auth.decorators.js';
import { isRecordNotFound, isUniqueViolation } from '../database/prisma-errors.js';
import { PrismaService } from '../database/prisma.service.js';

/** A Prisma Product row, where sellingPrice is a Decimal we serialize to a number. */
type ProductRow = Omit<Product, 'sellingPrice'> & { sellingPrice: { toString(): string } };

/** The contract exposes sellingPrice as a plain number; Prisma stores it as a Decimal. */
function toProduct(row: ProductRow): Product {
  return { ...row, sellingPrice: Number(row.sellingPrice.toString()) };
}

@Controller()
export class ProductsController {
  constructor(private readonly prisma: PrismaService) {}

  @Implement(contract.products.list)
  list() {
    return implement(contract.products.list).handler(async () => {
      const rows = await this.prisma.product.findMany({ orderBy: { sku: 'asc' } });
      return rows.map(toProduct);
    });
  }

  @Implement(contract.products.get)
  get() {
    return implement(contract.products.get).handler(async ({ input }) => {
      const row = await this.prisma.product.findUnique({ where: { id: input.id } });
      if (!row) throw new ORPCError('NOT_FOUND', { message: 'ไม่พบสินค้า' });
      return toProduct(row);
    });
  }

  @Roles('ADMINISTRATOR')
  @Implement(contract.products.create)
  create() {
    return implement(contract.products.create).handler(async ({ input }) => {
      try {
        const row = await this.prisma.product.create({ data: input });
        return toProduct(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ORPCError('CONFLICT', { message: 'รหัสสินค้า (SKU) นี้มีอยู่แล้ว' });
        }
        throw error;
      }
    });
  }

  @Roles('ADMINISTRATOR')
  @Implement(contract.products.update)
  update() {
    return implement(contract.products.update).handler(async ({ input }) => {
      const { id, ...data } = input;
      try {
        const row = await this.prisma.product.update({ where: { id }, data });
        return toProduct(row);
      } catch (error) {
        if (isRecordNotFound(error)) throw new ORPCError('NOT_FOUND', { message: 'ไม่พบสินค้า' });
        throw error;
      }
    });
  }

  @Roles('ADMINISTRATOR')
  @Implement(contract.products.deactivate)
  deactivate() {
    return implement(contract.products.deactivate).handler(({ input }) =>
      this.setActive(input.id, false),
    );
  }

  @Roles('ADMINISTRATOR')
  @Implement(contract.products.reactivate)
  reactivate() {
    return implement(contract.products.reactivate).handler(({ input }) =>
      this.setActive(input.id, true),
    );
  }

  private async setActive(id: string, active: boolean): Promise<Product> {
    try {
      const row = await this.prisma.product.update({ where: { id }, data: { active } });
      return toProduct(row);
    } catch (error) {
      if (isRecordNotFound(error)) throw new ORPCError('NOT_FOUND', { message: 'ไม่พบสินค้า' });
      throw error;
    }
  }
}
