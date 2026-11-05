// Dev tool: set a new password for an email/password user directly in the database.
// The password is read from the terminal without echo and is never passed as an argument.
// Usage: pnpm --filter @adelie/api auth:reset-password you@example.com
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { hashPassword } from 'better-auth/crypto';
import { createPrismaClient } from '@adelie/db';

const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: pnpm --filter @adelie/api auth:reset-password <email>');
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => {
      if (!muted) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

const prisma = createPrismaClient(process.env.DATABASE_URL);
try {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`No user with email ${email}`);

  const password = await askHidden('New password (min 8 chars): ');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  if (password !== (await askHidden('Repeat password: ')))
    throw new Error('Passwords do not match');

  const updated = await prisma.account.updateMany({
    where: { userId: user.id, providerId: 'credential' },
    data: { password: await hashPassword(password) },
  });
  if (updated.count === 0) throw new Error('User has no email/password account');

  // Sign out everywhere so old sessions do not outlive the reset.
  await prisma.session.deleteMany({ where: { userId: user.id } });
  console.log(`Password updated for ${email}. All sessions were signed out.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
