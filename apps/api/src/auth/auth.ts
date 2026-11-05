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
        // MVP-1: every new user gets a personal workspace where they are OWNER.
        after: async (user) => {
          await prisma.workspace.create({
            data: {
              name: user.name ? `${user.name}'s workspace` : 'My workspace',
              members: { create: { userId: user.id, role: 'OWNER' } },
            },
          });
        },
      },
    },
  },
});
