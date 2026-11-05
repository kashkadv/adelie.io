# Етап 2: модель даних соцмереж і метрик — пропозиція

- **Статус:** обговорення (рішень ще немає)
- **Створено:** 2026-11-05
- **Основа:** ТЗ §4.1, §6, §8, §10; результати PoC 1 — [integrations/pinterest.md](../integrations/pinterest.md)

## Сутності

```text
Workspace
 └── SocialConnection        OAuth-підключення (хто, яка платформа, зашифровані токени, scopes, статус)
      └── SocialAccount      профіль/акаунт платформи (Pinterest-акаунт Gushka)
           ├── SocialPost    одиниця контенту (пін)
           ├── MetricValue   значення метрик у часі (акаунта або поста)
           └── SyncRun       запуски синхронізації та їх результат
MetricDefinition             довідник метрик (спільний, не по workspace)
```

Усе, що належить клієнту, має `workspaceId` (ТЗ §4.3).

### SocialConnection
- `platform` (PINTEREST, далі INSTAGRAM, TIKTOK…), `externalUserId`, `scopes[]`.
- `accessToken`, `refreshToken` — **зашифровані** (AES-256-GCM, ключ `TOKEN_ENCRYPTION_KEY`,
  з полем `keyVersion` для майбутньої ротації ключа). Ніколи не віддаються у фронтенд.
- `accessTokenExpiresAt`, `refreshTokenExpiresAt`.
- `status`: ACTIVE / REAUTHORIZATION_REQUIRED / REVOKED; `connectedByUserId`.
- Унікальність: (workspace, platform, externalUserId).

### SocialAccount
- `externalId`, `username`, `displayName`, `avatarUrl`, `accountType` (BUSINESS…), лічильники профілю.
- `historyAvailableFrom` — з якої дати платформа віддала історію (для Pinterest: −90 днів від підключення).
- `collectingSince` — з якої дати Adelie сам щодня збирає дані (ТЗ §6.4: показуємо в UI).
- `lastSyncedAt`, `lastSuccessfulSyncAt`.

### SocialPost
- `externalId`, `url`, `contentType` (IMAGE, VIDEO, CAROUSEL, PRODUCT…), `title`, `description`,
  `thumbnailUrl`, `publishedAt`, `boardExternalId` (дошка — поки просто поле, окрема таблиця пізніше).

### MetricDefinition (довідник, заповнюється міграцією)
- `key` — наш ключ (напр. `impressions`, `saves`, `outbound_clicks`, `engagement_rate`).
- `platform` + `providerKey` (напр. PINTEREST / `IMPRESSION`) — оригінальна назва платформи.
- `unit` (COUNT, RATE, SECONDS), `aggregation` (SUM, AVG, LAST, NONE),
  `valueKind` (DAILY, LIFETIME, PERIOD, SNAPSHOT) — щоб не сумувати несумовне (ТЗ §6.3).
- Опис метрики — ключ i18n (тултіп «що означає метрика»).

### MetricValue (часовий ряд — одна «довга» таблиця)
- `workspaceId`, `accountId`, `postId?` (порожній — метрика акаунта), `metricKey`.
- `date` — день (UTC, як віддає платформа) або дата знімка для lifetime-значень.
- `value` — число **або `null`** (немає даних ≠ 0).
- `dataStatus` — READY / PROCESSING / ESTIMATE / UNAVAILABLE + `providerStatus`
  (оригінальний статус Pinterest, напр. `BEFORE_BUSINESS_CREATED`).
- `dimensions` (напр. `app_type=MOBILE`), `fetchedAt`, `source` (endpoint), `apiVersion`.
- Унікальність (account, post, metric, date, dimensions) → повторна синхронізація **оновлює**
  значення, а не дублює (ідемпотентність, ТЗ §8.3).

### SyncRun
- `kind` (INITIAL, DAILY, MANUAL, RETRY), `status` (pending, running, success, partial, failed,
  reauthorization_required — ТЗ §8.4), `startedAt`, `finishedAt`, статистика, код/текст помилки,
  `correlationId`.

## Синхронізація Pinterest (на основі PoC 1)

- **Первинна** (після підключення): профіль → піни (сторінками) → аналітика акаунта за 90 днів →
  метрики пінів.
- **Щоденна:** профіль, нові піни, аналітика за останні кілька днів (бо свіжі дні мають статус
  PROCESSING/ESTIMATE і уточнюються), lifetime-метрики пінів.
- **Ліміт аналітики 60 запитів/хв** → метрики пінів беремо пачками через `/pins?pin_metrics=true`,
  а не окремим запитом на кожен пін; адаптер читає `x-ratelimit-*` і пригальмовує.

## Питання на обговорення

1. **Метрики в одній «довгій» таблиці** (MetricValue) замість окремих колонок під кожну платформу —
   гнучко, нові платформи без міграцій. Обсяги в нас невеликі, Postgres впорається. Згоден?
2. **Сирі відповіді API** (raw payload) — у MVP не зберігати (ТЗ дозволяє «передбачити можливість»).
   Додамо, якщо знадобиться для аудиту/дебагу.
3. **Дошки (boards)** — поки лише поле в пості; окрема сутність і аналітика по дошках — пізніше.
4. **Часові пояси** — зберігаємо дати як віддає платформа (UTC), показуємо в часовому поясі workspace.
5. **Розбивка за пристроями** (`app_type`: mobile/tablet/web) — збирати з першого дня чи лише загальні
   цифри? Розбивка множить кількість запитів до аналітики.
