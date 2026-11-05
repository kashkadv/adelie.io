# Adelie

Marketing Intelligence platform — monorepo.
All project knowledge (requirements, decisions, plans, status) lives in [docs/](docs/README.md).

## Structure

```text
apps/
  api/      NestJS REST API + Better Auth           → http://localhost:4000
  web/      Next.js frontend                         → http://localhost:3000
  worker/   BullMQ background jobs
packages/
  db/       Prisma schema, migrations, client
  shared/   Shared types and queue contracts
infra/dev/  Docker Compose for PostgreSQL + Redis
docs/       Documentation (Ukrainian)
```

## Prerequisites

- Node.js 24 (`nvm use` reads `.nvmrc`)
- pnpm via corepack: `corepack enable`
- Access to the dev server over Tailscale (`ssh adelie@adelie`) —
  see [docs/infra/server-setup.md](docs/infra/server-setup.md)

## First run on a new machine

```bash
git clone git@github.com:kashkadv/adelie.io.git && cd adelie.io
nvm use && corepack enable
pnpm install
pnpm env:pull          # creates .env with dev server secrets (needs SSH to `adelie`)
pnpm build             # builds packages (db client, shared) and apps
pnpm dev               # api :4000, web :3000, worker
```

Open http://localhost:3000, create an account — a personal workspace is created automatically.

## Database

PostgreSQL and Redis run on the dev server (`infra/dev/docker-compose.yml`),
reachable only via Tailscale. To run them locally instead:

```bash
cp infra/dev/.env.example infra/dev/.env   # set passwords
docker compose -f infra/dev/docker-compose.yml up -d
# and point DATABASE_URL / REDIS_URL in .env at 127.0.0.1
```

Migrations:

```bash
pnpm db:migrate        # create/apply a migration in development
pnpm db:studio         # Prisma Studio
```

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
```

The same checks run in CI on every push to `main`.
