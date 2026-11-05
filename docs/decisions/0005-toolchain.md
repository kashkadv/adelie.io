# ADR-0005: Інструменти та версії

- **Статус:** прийнято
- **Дата:** 2026-11-05

## Контекст

Створення скелета монорепо (етап 1 MVP-1). Потрібно зафіксувати версії та
інструменти, щоб середовище однаково відтворювалось на обох ПК і в CI.

## Рішення

| Що | Вибір | Примітка |
|---|---|---|
| Node.js | 24 LTS (`.nvmrc`) | Node 26 щойно став LTS — перейдемо пізніше |
| Пакетний менеджер | pnpm 12 (через corepack, `packageManager` у package.json) | |
| Монорепо | pnpm workspaces + Turborepo | |
| TypeScript | 6.0.x | TS 7 (Go) ще не підтримують typescript-eslint і Nest CLI |
| API | NestJS 12 (ESM) | |
| Auth | Better Auth 1.7 + `@thallesp/nestjs-better-auth` | ADR-0003 |
| ORM | Prisma 7.10 (`prisma-client` generator, `@prisma/adapter-pg`) | Prisma 8 — ще RC |
| Frontend | Next.js 16 (App Router, Turbopack), React 19, Tailwind 4 | shadcn/ui — на етапі UI |
| Черги | BullMQ 6 + ioredis 6 | |
| БД / кеш | PostgreSQL 18, Redis 8 | Docker Compose |
| Тести | Vitest | |
| Lint | oxlint (api, з шаблону Nest 12), ESLint (web, з шаблону Next) | можна уніфікувати пізніше |
| Формат | Prettier (один конфіг у корені) | |
| CI | GitHub Actions: format, lint, typecheck, test, build | |

**Змінні середовища:** один `.env` у корені монорепо; кожен застосунок
читає його через `process.loadEnvFile`. Секрети dev-середовища живуть на
dev-сервері, `pnpm env:pull` генерує локальний `.env`.

**Безпека залежностей:** pnpm 12 за замовчуванням не встановлює версії,
опубліковані менше доби тому (`minimumReleaseAge`), і блокує install-скрипти
пакетів (дозволені явно в `pnpm-workspace.yaml` → `allowBuilds`). Не вимикати.
Якщо свіжа версія блокується — брати попередню.

## Наслідки

- Версії свіжі; деякі API відрізняються від поширених прикладів (Prisma 7, Nest 12 ESM,
  Next 16). Перед змінами звірятися з документацією конкретної версії
  (для Next — `node_modules/next/dist/docs/`, див. `apps/web/AGENTS.md`).
- Два лінтери — тимчасовий компроміс заради шаблонів за замовчуванням.
