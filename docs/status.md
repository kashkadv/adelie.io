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
- Домен `adelie.space` на Cloudflare; пошта `hello@`/`privacy@` → Gmail (Email Routing). Приватна мережа: Tailscale.
- Dev-сервер: VM `adelie` на Proxmox — Docker, PostgreSQL 18, Redis 8 (лише через Tailscale): [infra/server-setup.md](infra/server-setup.md).
- Скелет монорепо: api (NestJS + Better Auth), web (Next.js), worker (BullMQ), db (Prisma), shared; CI.
  Перевірено наживо проти dev-сервера: реєстрація → автоматичний workspace, чужий workspace → 404,
  без сесії → 401, worker обробляє задачу з черги.
- Публічний сайт https://adelie.space (лендінг + privacy policy, en/uk, світла/темна тема) через Cloudflare Tunnel.
- Бренд: оригінальний силует пінгвіна — `assets/brand/penguin-original.svg`; логотип і favicon на сайті та в застосунку
  (іконки генерує `node scripts/brand-icons.mjs`). Назва — завжди «Adelie» з великої.
- Шрифти: Onest (заголовки) + Tektur (назва «Adelie», текст); Unbounded і Geologica спробували й відмовились, self-hosted. Шапка/футер сайту й застосунку ідентичні.
- Мультимовність: en + uk, нові мови додаються без переробок (ADR-0006). Як запустити — [README](../README.md).

## На чому зупинились

Скелет працює: `pnpm dev` успішно запущено на Mac, перший користувач зареєстрований через браузер.
Досліджено Pinterest API: [integrations/pinterest.md](integrations/pinterest.md) — історія лише 90 днів,
trial — 1000 запитів/добу, для заявки потрібна privacy policy на `adelie.space`.
Лишилось перевірити запуск з нуля на стаціонарному ПК.

## Наступні кроки

1. Стаціонарний ПК: Tailscale → `git clone` → кроки з README (`pnpm env:pull && pnpm build && pnpm dev`).
2. Pinterest: застосунок `Adelie` (ID 1635003) — **Trial активний**, App secret на сервері.
   Redirect URI додано, тестовий маркер PoC 1 відкликано.
3. Модель даних етапу 2 **узгоджено**: [plans/stage-2-data-model.md](plans/stage-2-data-model.md),
   ADR-0007 (workspace → проєкти → акаунти) і ADR-0008 (зберігання метрик).
4. Етап 2, реалізація: ✅ Prisma-схема й міграція `stage2_social_metrics` (застосована на dev-сервері:
   існуючий workspace отримав перший проєкт, довідник — 15 метрик Pinterest; роль MANAGER; реєстрація
   створює проєкт). Далі: шифрування токенів → adapter-контракт → OAuth Pinterest → синхронізація у worker
   → PoC 2 на акаунті Gushka.

## Відкриті питання

- 2FA на Pinterest-акаунті Adelie (власник застосунку): SMS на +380 не пройшла — спробувати пізніше або через застосунок-автентифікатор.

- Хостинг production — кандидат домашній Proxmox, вирішуємо на етапі 4.
- Privacy policy — чорновик для MVP; перед комерційним запуском переглянути юридично.
- Etsy — майбутній напрям E-commerce Intelligence, поза MVP.
- Деталі інфраструктури: [plans/infra-discussion.md](plans/infra-discussion.md).
