import { oc } from '@orpc/contract';
import * as z from 'zod';
import { StoreSchema } from './auth.js';

/**
 * Read-only store directory. A purchase order picks a destination store from this list (T5), so the
 * web form needs the stores by id and name. Stores are seeded, not created through the API yet.
 */
export const storesContract = {
  list: oc
    .route({ method: 'GET', path: '/stores', summary: 'List stores', tags: ['Stores'] })
    .output(z.array(StoreSchema)),
};
