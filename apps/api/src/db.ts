import { createPrismaClient } from '@adelie/db';
import { config } from './config.js';

// One Prisma client per process, shared by Better Auth and Nest providers.
export const prisma = createPrismaClient(config.databaseUrl);
export type Prisma = typeof prisma;
