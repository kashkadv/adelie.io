import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { config } from '../config.js';
import { prisma } from '../db.js';

export const auth = betterAuth({
  secret: config.auth.secret,
  baseURL: config.auth.url,
  basePath: '/api/auth',
  trustedOrigins: [config.webUrl],
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
  },
  databaseHooks: {
    user: {
      create: {
        // MVP-1: every new user gets a personal workspace where they are OWNER,
        // with a first project (ADR-0007).
        after: async (user) => {
          const name = user.name ? `${user.name}'s workspace` : 'My workspace';
          await prisma.workspace.create({
            data: {
              name,
              members: { create: { userId: user.id, role: 'OWNER' } },
              projects: { create: { name: user.name || 'My project' } },
            },
          });
        },
      },
    },
  },
});
