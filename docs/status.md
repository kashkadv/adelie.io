# Статус проєкту

_Оновлено: 2026-11-05_

## Поточний етап

**MVP-1, етап 1 (Foundation)** — скелет готовий, лишилась перевірка на другому ПК.
Паралельно чекає **етап 0** (Pinterest developer app). План: [plans/mvp-1.md](plans/mvp-1.md).

## Зроблено

- Репозиторій `kashkadv/adelie.io`, правила роботи: [rules.md](rules.md).
- Вимоги: [product-requirements.md](product-requirements.md). Обговорення MVP: [plans/mvp-discussion.md](plans/mvp-discussion.md).
- Рішення: стек (ADR-0002), Better Auth (ADR-0003), Pinterest першим (ADR-0004), інструменти й версії (ADR-0005).
- Перший користувач — Gushka (Instagram, Pinterest, Etsy).
- Домен `adelie.space` на Cloudflare. Приватна мережа: Tailscale.
- Dev-сервер: VM `adelie` на Proxmox — Docker, PostgreSQL 18, Redis 8 (лише через Tailscale): [infra/server-setup.md](infra/server-setup.md).
- Скелет монорепо: api (NestJS + Better Auth), web (Next.js), worker (BullMQ), db (Prisma), shared; CI.
  Перевірено наживо проти dev-сервера: реєстрація → автоматичний workspace, чужий workspace → 404,
  без сесії → 401, worker обробляє задачу з черги.
- Мультимовність: en + uk, нові мови додаються без переробок (ADR-0006). Як запустити — [README](../README.md).

## На чому зупинились

Скелет закомічено. `pnpm dev` (режим watch) ще не прогнаний — перевірено лише зібрані застосунки.

## Наступні кроки

1. На ПК увімкнути Tailscale, потім `pnpm env:pull && pnpm build && pnpm dev` — перевірити з нуля (і на другому ПК).
2. Створити developer app на developers.pinterest.com → етап 0 (PoC Pinterest API).
3. Етап 2: adapter-контракт, схема соцмереж/метрик, OAuth Pinterest.

## Відкриті питання

- Хостинг production — кандидат домашній Proxmox, вирішуємо на етапі 4.
- Cloudflare Tunnel — налаштувати, коли знадобиться публічна сторінка (privacy policy для Pinterest).
- Etsy — майбутній напрям E-commerce Intelligence, поза MVP.
- Деталі інфраструктури: [plans/infra-discussion.md](plans/infra-discussion.md).
