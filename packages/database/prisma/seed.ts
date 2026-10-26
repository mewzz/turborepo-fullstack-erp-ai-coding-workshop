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
    const storeId = user.store ? (storesByCode.get(user.store) ?? null) : null;
    const data = { name: user.name, role: user.role, storeId };
    await prisma.user.upsert({
      where: { email: user.email },
      update: data,
      create: { email: user.email, passwordHash, ...data },
    });
  }
  console.log(
    `Seeded ${stores.length} stores and ${demoUsers.length} demo users (password: "${DEMO_PASSWORD}").`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
