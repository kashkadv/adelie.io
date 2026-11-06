# Статус проєкту

_Оновлено: 2026-11-06_

## Поточний етап

**MVP-1, етап 2 (соцмережі й метрики)** — модель даних узгоджена й у базі, шифрування токенів готове;
далі — контракт адаптера платформ і OAuth Pinterest. Паралельно зроблено дизайн-оболонку застосунку
й профіль користувача. План: [plans/mvp-1.md](plans/mvp-1.md).

## Зроблено

- Репозиторій `kashkadv/adelie.io`, правила роботи: [rules.md](rules.md).
- Вимоги: [product-requirements.md](product-requirements.md). Обговорення MVP: [plans/mvp-discussion.md](plans/mvp-discussion.md).
- Рішення: стек (ADR-0002), Better Auth (ADR-0003), Pinterest першим (ADR-0004), інструменти й версії (ADR-0005),
  мови (ADR-0006), workspace → проєкти → акаунти (ADR-0007), зберігання метрик (ADR-0008), дизайн-система (ADR-0009),
  профіль користувача (ADR-0010).
- Перший користувач — Gushka (Instagram, Pinterest, Etsy).
- Домен `adelie.space` на Cloudflare; пошта `hello@`/`privacy@` → Gmail (Email Routing). Приватна мережа: Tailscale.
- Dev-сервер: VM `adelie` на Proxmox — Docker, PostgreSQL 18, Redis 8 (лише через Tailscale): [infra/server-setup.md](infra/server-setup.md).
- Скелет монорепо: api (NestJS + Better Auth), web (Next.js), worker (BullMQ), db (Prisma), shared; CI.
- Публічний сайт https://adelie.space (лендінг + privacy policy, en/uk, світла/темна тема) через Cloudflare Tunnel.
- Бренд: оригінальний силует пінгвіна — `assets/brand/penguin-original.svg`; логотип і favicon (`node scripts/brand-icons.mjs`).
- Шрифти (ADR-0009): Inter (текст), Onest (заголовки), Playwrite IT Trad 300 (назва «Adelie»); Tektur, Yuyu Short,
  Unbounded і Geologica спробували й відмовились; self-hosted (`scripts/brand-fonts.py`).
- **Етап 2:** Prisma-схема й міграції (проєкти, підключення, акаунти, дошки, піни, метрики, синхронізація, сирі
  відповіді) застосовані на dev-сервері; шифрування токенів AES-256-GCM з ротацією ключа (`@adelie/shared/crypto`).
- **Дизайн (ADR-0009):** застосунок на весь екран у два шари — шапка (лого, перемикач проєкту; тема, мова, аватарка)
  і сайдбар на фоні, контент у піднятій скляній панелі; сайдбар згортається; пінгвінячі тони; світла/темна тема;
  палітра графіків перевірена на розрізнюваність; сторінки-заготовки Огляд/Акаунти/Контент/Звіти/Налаштування.
  Власні елементи керування (випадні списки, скролбари), пояснення — іконкою «i» з підказкою.
- **Профіль (ADR-0010):** сторінка «Профіль» `/me` з меню аватарки — ім'я, прізвище, посада, фото, контакти,
  робочий час; видно лише колегам зі спільних workspace; privacy policy доповнено.
- Dev-інструменти: скидання пароля `pnpm --filter @adelie/api auth:reset-password <email>`; око в полі пароля.

## На чому зупинились

Сесія 2026-11-05/06 закінчилась на дизайні профілю: усе закомічено, CI зелений. Сайт `adelie.space`
з новим лого, шрифтом Inter і оновленою privacy policy **ще не задеплоєний** — чекає рішення власника.

## Наступні кроки

1. **Задеплоїти сайт** (`scripts/deploy-edge.sh`) — нове лого/шрифти й пункт про дані профілю в privacy policy.
2. **Етап 2:** запропонувати й обговорити контракт адаптера платформ → OAuth Pinterest
   (`GET /social/:platform/callback`, токени через `@adelie/shared/crypto`) → синхронізація у worker
   (первинна 90 днів + щоденна) → PoC 2 на акаунті Gushka. Модель: [plans/stage-2-data-model.md](plans/stage-2-data-model.md).
3. Сторінка команди з профілями колег (ADR-0010) і керування доступами до проєктів.
4. Стаціонарний ПК: Tailscale → `git clone` → кроки з README (`pnpm env:pull && pnpm build && pnpm dev`).

Підказки для локального запуску:
- `pnpm` є лише в Node 24: у новій вкладці `nvm use` (або раз `nvm alias default 24`).
- Якщо після перенесення сторінок `pnpm dev` віддає стару розмітку — `rm -rf apps/web/.next` і перезапуск.
- Повну перевірку як у CI робити в чистому клоні (rules.md §4), а не `build` у робочій копії поруч із `pnpm dev`.

## Відкриті питання

- 2FA на Pinterest-акаунті Adelie (власник застосунку): SMS на +380 не пройшла — спробувати пізніше або через застосунок-автентифікатор.
- Next.js dev показує «Insight» про instant navigation для сторінок застосунку — розібратися (не помилка, лише dev-перевірка).
- Хостинг production — кандидат домашній Proxmox, вирішуємо на етапі 4.
- Privacy policy — чорновик для MVP; перед комерційним запуском переглянути юридично.
- Etsy — майбутній напрям E-commerce Intelligence, поза MVP.
- Деталі інфраструктури: [plans/infra-discussion.md](plans/infra-discussion.md).
