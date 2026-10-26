# AGENTS.md (apps/api)

Rules for `@erp/api` (NestJS 12, native ESM, oRPC via `@orpc/nest`, Prisma via `@erp/database`). The [root AGENTS.md](../../AGENTS.md) still applies.

- **One Nest module per feature** in `src/<feature>/` (`<feature>.module.ts`, `<feature>.controller.ts`), registered in `src/app.module.ts`.
- **Implement contract routes, don't declare your own.** Every handler is `@Implement(contract.<feature>.<route>)` returning `implement(contract.<feature>.<route>).handler(...)`. Reference: `src/health/health.controller.ts`.
- **No `class-validator` DTOs.** Input is already validated and typed by the contract's Zod schemas.
- **Database access** only through the injected `PrismaService` (`src/database`, global). Never create a `PrismaClient` yourself.
- **Every route requires a signed-in user** (global `AuthGuard`). Opt out with `@Public()`, restrict with `@Roles('ADMINISTRATOR')`, limit a `STORE_EMPLOYEE` to their own store with `@StoreScoped('storeId')` (reads the target store id from route params or body), and read the user with a `@CurrentUser() user: User` parameter on the `@Implement` method. All three live in `src/auth/auth.decorators.ts`.
- The global prefix is `/api`. Contract paths don't repeat it.
- Tests are colocated `*.spec.ts` files. See the `write-tests` skill.
