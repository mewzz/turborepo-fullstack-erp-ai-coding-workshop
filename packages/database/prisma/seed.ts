import { createPrismaClient, hashPassword, Role } from '../src/index.js';

const prisma = createPrismaClient(
  process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp',
);

// Stores the demo users are scoped to.
const stores = [
  { code: 'B01', name: 'Central' },
  { code: 'B02', name: 'Riverside' },
];

// Demo accounts for the workshop (also shown on the login page). Re-running the seed resets them.
// `store` is the store code a STORE_EMPLOYEE is assigned to; other roles have none.
const demoUsers = [
  { email: 'admin@erp.local', name: 'Admin User', role: Role.ADMINISTRATOR, store: null },
  { email: 'buyer01@erp.local', name: 'Buyer One', role: Role.PURCHASING_OFFICER, store: null },
  { email: 'staff_b01@erp.local', name: 'Staff B01', role: Role.STORE_EMPLOYEE, store: 'B01' },
  { email: 'staff_b02@erp.local', name: 'Staff B02', role: Role.STORE_EMPLOYEE, store: 'B02' },
  { email: 'manager01@erp.local', name: 'Manager One', role: Role.MANAGER, store: null },
];
const DEMO_PASSWORD = 'password';

// Demo catalogue (TOR §8): SKU001-003 with a reorder threshold of 3 (thresholds are per store,
// added in a later slice). Prices are the selling prices used across the acceptance scenarios.
const products = [
  { sku: 'SKU001', name: 'สินค้า 001', category: 'ทั่วไป', unit: 'ชิ้น', sellingPrice: '45.00' },
  { sku: 'SKU002', name: 'สินค้า 002', category: 'ทั่วไป', unit: 'ชิ้น', sellingPrice: '30.00' },
  { sku: 'SKU003', name: 'สินค้า 003', category: 'ทั่วไป', unit: 'ชิ้น', sellingPrice: '12.50' },
];

// Demo supplier (TOR §8).
const suppliers = [
  {
    code: 'SUP01',
    name: 'บริษัท ซัพพลายเออร์ ตัวอย่าง จำกัด',
    contactName: 'ฝ่ายขาย',
    contactEmail: 'sales@sup01.local',
    contactPhone: '021112222',
  },
];

// Opening stock per store (TOR §8). Quantities are whole units; the reorder threshold is 3 for
// every (product, store). B01 opens with SKU001=10, SKU002=5, SKU003=0; B02 opens all zero.
// The ledger is the source of truth, so a nonzero opening also writes an OPENING movement.
const REORDER_THRESHOLD = 3;
const openingStock: Record<string, Record<string, number>> = {
  B01: { SKU001: 10, SKU002: 5, SKU003: 0 },
  B02: { SKU001: 0, SKU002: 0, SKU003: 0 },
};

async function main() {
  const storesByCode = new Map<string, string>();
  for (const store of stores) {
    const row = await prisma.store.upsert({
      where: { code: store.code },
      update: { name: store.name },
      create: store,
    });
    storesByCode.set(store.code, row.id);
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const user of demoUsers) {
    let storeId: string | null = null;
    if (user.store) {
      storeId = storesByCode.get(user.store) ?? null;
      if (!storeId) throw new Error(`Unknown store code "${user.store}" for ${user.email}`);
    }
    const data = { name: user.name, role: user.role, storeId, passwordHash };
    await prisma.user.upsert({
      where: { email: user.email },
      update: data,
      create: { email: user.email, ...data },
    });
  }
  console.log(
    `Seeded ${stores.length} stores and ${demoUsers.length} demo users (password: "${DEMO_PASSWORD}").`,
  );

  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: product,
      create: product,
    });
  }

  for (const supplier of suppliers) {
    await prisma.supplier.upsert({
      where: { code: supplier.code },
      update: supplier,
      create: supplier,
    });
  }

  console.log(`Seeded ${products.length} products and ${suppliers.length} suppliers.`);

  // Opening stock. Re-runnable: a per-(product, store) upsert keyed on the unique pair, and an
  // OPENING movement only when there isn't one yet, so re-seeding never double-counts the ledger.
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@erp.local' } });
  const productsBySku = new Map<string, string>();
  for (const product of products) {
    const row = await prisma.product.findUniqueOrThrow({ where: { sku: product.sku } });
    productsBySku.set(product.sku, row.id);
  }

  let balanceCount = 0;
  for (const [storeCode, quantities] of Object.entries(openingStock)) {
    const storeId = storesByCode.get(storeCode);
    if (!storeId) throw new Error(`Unknown store code "${storeCode}" in opening stock`);
    for (const [sku, quantity] of Object.entries(quantities)) {
      const productId = productsBySku.get(sku);
      if (!productId) throw new Error(`Unknown SKU "${sku}" in opening stock`);

      // `quantity` is a derived balance, so it is set only when the row is first created. On a
      // re-seed we refresh the threshold (configuration) but never reset a quantity that real
      // movements may have changed — resetting it would break INV-03 reconciliation.
      const existing = await prisma.stockBalance.findUnique({
        where: { productId_storeId: { productId, storeId } },
      });
      if (existing) {
        await prisma.stockBalance.update({
          where: { id: existing.id },
          data: { reorderThreshold: REORDER_THRESHOLD },
        });
      } else {
        await prisma.stockBalance.create({
          data: { productId, storeId, quantity, reorderThreshold: REORDER_THRESHOLD, version: 0 },
        });
        if (quantity > 0) {
          await prisma.stockMovement.create({
            data: {
              productId,
              storeId,
              delta: quantity,
              balanceBefore: 0,
              balanceAfter: quantity,
              type: 'OPENING',
              sourceDocument: 'OPENING',
              actorId: admin.id,
            },
          });
        }
      }
      balanceCount++;
    }
  }

  console.log(`Seeded ${balanceCount} stock balances (threshold ${REORDER_THRESHOLD}).`);

  // A demo draft purchase order (T5) so the lifecycle screen has something to act on. Re-runnable:
  // keyed on its document number, with lines snapshotting the product name and a purchase price.
  const buyer = await prisma.user.findUniqueOrThrow({ where: { email: 'buyer01@erp.local' } });
  const supplierRow = await prisma.supplier.findUniqueOrThrow({ where: { code: 'SUP01' } });
  const centralStoreId = storesByCode.get('B01');
  if (!centralStoreId) throw new Error('Missing demo store B01 for the demo purchase order');
  const demoLines = [
    { sku: 'SKU001', quantity: 10, purchasePrice: '25.00' },
    { sku: 'SKU002', quantity: 5, purchasePrice: '18.00' },
  ];
  const existingOrder = await prisma.purchaseOrder.findUnique({ where: { number: 'PO-0001' } });
  if (!existingOrder) {
    await prisma.purchaseOrder.create({
      data: {
        number: 'PO-0001',
        supplierId: supplierRow.id,
        destinationStoreId: centralStoreId,
        expectedReceiptDate: '2026-01-15',
        status: 'DRAFT',
        createdById: buyer.id,
        lines: {
          create: await Promise.all(
            demoLines.map(async (line) => {
              const product = await prisma.product.findUniqueOrThrow({
                where: { sku: line.sku },
              });
              return {
                productId: product.id,
                productName: product.name,
                purchasePrice: line.purchasePrice,
                quantity: line.quantity,
              };
            }),
          ),
        },
      },
    });
  }
  console.log('Seeded 1 demo purchase order (PO-0001, draft).');
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
