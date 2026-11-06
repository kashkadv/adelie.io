import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError } from 'better-auth/api';
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
  // Always on (Better Auth enables it only in production by default): stops password guessing.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
    },
  },
  advanced: {
    cookiePrefix: config.auth.cookiePrefix,
    ...(config.auth.cookieDomain
      ? { crossSubDomainCookies: { enabled: true, domain: config.auth.cookieDomain } }
      : {}),
    // Behind Cloudflare the client IP comes in CF-Connecting-IP (rate limits key on it).
    ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
  },
  databaseHooks: {
    user: {
      create: {
        // Deployed dev/staging: only allowlisted emails may sign up (SIGNUP_ALLOWLIST).
        before: async (user) => {
          const list = config.auth.signupAllowlist;
          if (list.length && !list.includes(user.email.toLowerCase())) {
            throw new APIError('FORBIDDEN', { message: 'Registration is closed' });
          }
          return { data: user };
        },
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
