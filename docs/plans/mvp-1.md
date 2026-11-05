# План MVP-1: Pinterest end-to-end

- **Статус:** в роботі
- **Створено:** 2026-11-05
- **Контекст:** [mvp-discussion.md](mvp-discussion.md), ADR [0002](../decisions/0002-stack-and-monorepo.md),
  [0003](../decisions/0003-auth.md), [0004](../decisions/0004-platform-order.md)

## Мета

Gushka (власник проєкту від його імені) може: увійти в Adelie → підключити
Pinterest-акаунт → дані синхронізуються у фоні щодня → бачити метрики акаунта,
їх динаміку та список пінів із сортуванням за метриками.

## Поза межами MVP-1

Інвайти й ролі в UI, інші платформи, dashboard workspace, порівняння, AI, звіти.
Модель даних при цьому закладається з урахуванням ТЗ (multi-tenant, provenance метрик).

---

## Етап 0. Перевірка Pinterest API

Мета — підтверджені можливості замість припущень (ТЗ 5.2).

- [x] Створити developer app на developers.pinterest.com _(власник проєкту)_ — ID 1635003, чекає trial
- [ ] З'ясувати рівень доступу (trial / standard) і що він дозволяє
- [ ] Налаштувати redirect URI для локальної розробки
- [x] PoC-скрипт (`scripts/pinterest-poc.sh`) з тестовим маркером; OAuth-flow — після схвалення trial
- [x] PoC: профіль акаунта, борди, піни (з пагінацією) — на порожньому акаунті
- [ ] PoC: аналітика акаунта і аналітика пінів
- [ ] Задокументувати в `docs/integrations/pinterest.md`:
      scopes, endpoints, доступні метрики та їх визначення, глибина історії,
      rate limits, вимоги до типу акаунта, життя токенів, вимоги для production access

**Критерій готовності:** реальні дані акаунта Gushka отримано, обмеження задокументовано.

## Етап 1. Foundation

- [x] pnpm-монорепо: `apps/web`, `apps/api`, `apps/worker`, `packages/db`, `packages/shared`
- [x] Спільні налаштування TypeScript, Prettier; lint: oxlint (api) + ESLint (web) — ADR-0005
- [x] Docker Compose: PostgreSQL, Redis
- [x] `packages/db`: Prisma, базова схема (User, Workspace, WorkspaceMember + таблиці Better Auth)
- [x] `apps/api`: NestJS, Better Auth, health-check, guard перевірки членства у workspace
- [x] Автоматичне створення workspace при реєстрації
- [x] `apps/web`: Next.js, Tailwind, сторінки логіну/реєстрації, головна зі списком workspace
- [ ] shadcn/ui — перенесено на етап 3 (UI)
- [x] `apps/worker`: BullMQ, тестова задача
- [x] Тести: налаштований runner, перший тест tenant-ізоляції
- [x] CI (GitHub Actions): lint, typecheck, test
- [x] README з інструкцією локального запуску (важливо для двох ПК)

- [ ] Перевірити запуск з нуля на другому ПК

**Критерій готовності:** на чистому ПК `git clone` → інструкція з README →
працюють реєстрація, логін, web бачить api, worker обробляє тестову задачу.

## Етап 2. Інтеграція Pinterest

- [ ] Контракт `SocialPlatformAdapter` у `packages/shared` (ТЗ 10)
- [ ] Схема: SocialConnection, SocialAccount, SocialPost, MetricDefinition,
      MetricSnapshot, SyncJob/SyncRun
- [ ] Шифрування токенів у стані спокою
- [ ] OAuth-підключення Pinterest (state, redirect URI, refresh, revoke)
- [ ] Pinterest adapter: профіль, піни, метрики; помилки, rate limits, пагінація
- [ ] Unit-тести adapter на mock-відповідях
- [ ] Worker: первинна синхронізація після підключення
- [ ] Worker: щоденне оновлення + snapshots
- [ ] Retry з backoff, статуси синхронізації (ТЗ 8.4), ручний перезапуск

**Критерій готовності:** після підключення дані з'являються в БД, щоденна синхронізація
накопичує snapshots, помилки видно в SyncRun.

## Етап 3. UI

- [ ] Сторінка підключень: статус, остання синхронізація, перепідключення, відключення
- [ ] Сторінка акаунта: основні метрики, графіки динаміки, доступний період історії
- [ ] Список пінів: сортування за метриками, фільтр за періодом, посилання на пін
- [ ] Стани loading / empty / partial / error; відсутні дані ≠ 0
- [ ] Пояснення (tooltip) що означає кожна метрика

## Етап 4. Розгортання для Gushka

- [ ] Вибір хостингу → ADR
- [ ] Production-середовище, секрети, бекапи БД
- [ ] Privacy policy / terms (потрібні для production access платформ)
- [ ] Production access Pinterest, якщо trial недостатньо
- [ ] Підключити реальний акаунт Gushka в production

**Критерій готовності MVP-1:** Gushka щодня отримує актуальні дані Pinterest в Adelie.
