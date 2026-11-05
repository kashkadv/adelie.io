# ADR-0002: Стек і структура монорепо

- **Статус:** прийнято
- **Дата:** 2026-11-05

## Контекст

ТЗ (розділ 9) рекомендує NestJS + Next.js + Prisma + PostgreSQL + Redis/BullMQ.
Обговорення: [plans/mvp-discussion.md](../plans/mvp-discussion.md).

## Рішення

Варіант A — окремі frontend, API та worker у pnpm-монорепо:

```text
apps/
  web/      Next.js (App Router), React, TypeScript, Tailwind, shadcn/ui
  api/      NestJS, REST API
  worker/   BullMQ workers + scheduler
packages/
  db/       Prisma schema і клієнт
  shared/   спільні типи, API-контракти, константи
docs/
```

- PostgreSQL, Redis, BullMQ.
- Docker Compose для локального середовища.
- На старті без надмірностей: API і worker можуть ділити код NestJS-модулів
  (два entrypoints), якщо це спрощує роботу. Точну форму визначимо при створенні скелета.
- Хостинг поки не обираємо.

## Альтернативи

- **B:** Next.js full-stack + окремий worker. Швидший старт, але API не окремий,
  розходиться з принципом API-first із ТЗ.

## Наслідки

- Більше початкової обв'язки (монорепо, кілька процесів), зате чіткий поділ
  і відповідність ТЗ.
- Потрібні спільні контракти в `packages/shared` між web і api.
