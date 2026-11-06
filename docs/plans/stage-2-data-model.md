# Етап 2: модель даних соцмереж і метрик — пропозиція

- **Статус:** узгоджено ([ADR-0008](../decisions/0008-metrics-storage.md)), далі — реалізація
- **Створено:** 2026-11-05
- **Основа:** ТЗ §4.1, §6, §8, §10; результати PoC 1 — [integrations/pinterest.md](../integrations/pinterest.md)

## Сутності

Структура простору — [ADR-0007](../decisions/0007-workspace-projects.md): workspace → проєкти → акаунти.

```text
Workspace                    організація (агенція/бізнес): команда, ролі, ізоляція даних
 ├── WorkspaceMember         роль у workspace (Owner/Admin/Manager/Analyst/Viewer)
 └── Project                 клієнт агенції або бренд: налаштування, звіти
      ├── ProjectMember      призначення співробітника на проєкт (для Manager/Analyst/Viewer)
      └── SocialConnection   OAuth-підключення (платформа, зашифровані токени, scopes, статус)
           └── SocialAccount профіль/акаунт платформи (Pinterest-акаунт Gushka)
                ├── SocialBoard   дошка Pinterest
                ├── SocialPost    одиниця контенту (пін)
                ├── AccountMetricValue / PostMetricValue   значення метрик у часі
                ├── PostMetricsLatest  похідний «широкий» рядок на пін
                └── SyncRun       запуски синхронізації та їх результат
MetricDefinition             довідник метрик (спільний, не по workspace)
```

Усе, що належить клієнту, має `workspaceId` (ізоляція, ТЗ §4.3) і `projectId` (доступ за проєктом).

### Project
- `name`, `timezone`, `currency`, `reportLocale` (налаштування клієнта/бренду переїжджають сюди з Workspace).
- При реєстрації створюється workspace + перший проєкт.

### ProjectMember
- (project, workspaceMember). Owner/Admin бачать усі проєкти без призначення.

### SocialConnection
- `platform` (PINTEREST, далі INSTAGRAM, TIKTOK…), `externalUserId`, `scopes[]`.
- `accessToken`, `refreshToken` — **зашифровані** (AES-256-GCM, ключ `TOKEN_ENCRYPTION_KEY`,
  з полем `keyVersion` для майбутньої ротації ключа). Ніколи не віддаються у фронтенд.
  Реалізовано: `@adelie/shared/crypto` — формат `v<версія>.<iv>.<tag>.<дані>`; шифротекст прив'язаний
  до контексту (AAD: workspace, платформа, користувач, поле), тож скопійований в інший рядок не розшифрується.
  Ротація: `TOKEN_ENCRYPTION_KEY_VERSION` + `TOKEN_ENCRYPTION_PREVIOUS_KEYS` (див. `.env.example`).
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
  `thumbnailUrl`, `publishedAt`, `boardId?` (посилання на `SocialBoard`).

### SocialBoard (вирішено — питання 3)
- `workspaceId`, `projectId`, `accountId`, `externalId`, `name`, `description`, `privacy`, `pinCount`, `coverUrl`.
- Синхронізується через `GET /boards` (ліміт `org_read`, не аналітика) разом із пінами.
- Аналітика дошки — **наша агрегація** метрик пінів за дошкою (з `PostMetricsLatest`),
  без окремих запитів аналітики до Pinterest.
- Відкладено: секції дошок, спільні (group) дошки з пінами інших авторів.
- Назва навмисно Pinterest-специфічна: аналога в API Instagram/TikTok немає, узагальнювати рано.

### MetricDefinition (довідник, заповнюється міграцією)
- `key` — наш ключ (напр. `impressions`, `saves`, `outbound_clicks`, `engagement_rate`).
- `platform` + `providerKey` (напр. PINTEREST / `IMPRESSION`) — оригінальна назва платформи.
- `unit` (COUNT, RATE, SECONDS), `aggregation` (SUM, AVG, LAST, NONE),
  `valueKind` (DAILY, LIFETIME, PERIOD, SNAPSHOT) — щоб не сумувати несумовне (ТЗ §6.3).
- Опис метрики — ключ i18n (тултіп «що означає метрика»).

### AccountMetricValue / PostMetricValue (часовий ряд — «довгий» формат)

Реалізовано двома таблицями однакової форми (див. ADR-0008): денний ряд акаунта і знімки пінів.
Опис полів нижче — спільний.

- `workspaceId`, `accountId`, `postId?` (порожній — метрика акаунта), `metricKey`.
- `date` — день (UTC, як віддає платформа) або дата знімка для lifetime-значень.
- `value` — число **або `null`** (немає даних ≠ 0).
- `dataStatus` — READY / PROCESSING / ESTIMATE / UNAVAILABLE + `providerStatus`
  (оригінальний статус Pinterest, напр. `BEFORE_BUSINESS_CREATED`).
- `dimensions` (напр. `app_type=MOBILE`), `fetchedAt`, `source` (endpoint), `apiVersion`.
- Унікальність (account, post, metric, date, dimensions) → повторна синхронізація **оновлює**
  значення, а не дублює (ідемпотентність, ТЗ §8.3).

### Обсяг і похідний шар (вирішено, питання 1)
- **Акаунт × день** — зберігаємо завжди й повністю (дешево: ~3,6 тис. рядків/акаунт/рік;
  Pinterest віддає лише 90 днів, втрачене не відновити).
- **Знімки метрик пінів** — новий рядок **лише при зміні значення** (закладаємо одразу).
  Прорідження (старші 90 днів → тижневі, старші за рік → місячні знімки) — нічна задача worker'а, пізніше.
- **Похідна таблиця `PostMetricsLatest`** — «широкий» рядок на пін (impressions, saves, clicks…) для
  сортування й топів. Перераховується задачею worker'а після синхронізації акаунта (за діапазон,
  що оновився; ідемпотентно).
- **Проєкт / тиждень / місяць** — не зберігаємо, рахуємо запитом з денних даних (за потреби — кеш).
  Агрегатор бере правило з `MetricDefinition`: SUM / LAST / перерахунок із компонентів (rate);
  статус агрегату — найгірший серед складових; немає даних → `null`. Доба — за UTC (як віддає платформа).

### SyncRun
- `kind` (INITIAL, DAILY, MANUAL, RETRY), `status` (pending, running, success, partial, failed,
  reauthorization_required — ТЗ §8.4), `startedAt`, `finishedAt`, статистика, код/текст помилки,
  `correlationId`.

### SyncPayload (сирі відповіді API, вирішено — питання 2)
- `workspaceId`, `syncRunId`, `endpoint`, параметри запиту, `httpStatus`, `fetchedAt`, `body` (`jsonb`).
- Лише тіло відповіді — без заголовків запиту (токенів там немає).
- **Навіщо:** перерахувати `MetricValue`, якщо адаптер помилився в маппінгу (дані старші 90 днів
  у Pinterest уже не перезапитати), дебаг розбіжностей «у вас не так, як у Pinterest», нові метрики з архіву.
- **Строк зберігання — 90 днів**, далі видаляє нічна задача worker'а. Видаляється разом з акаунтом/workspace.
- Згодом можна винести в об'єктне сховище, якщо обсяг заважатиме.

## Адаптер платформ (ADR-0011)

Реалізовано в `packages/platforms` (`@adelie/platforms`): контракт `PlatformAdapter`, типізовані помилки,
спільний `HttpClient` (ліміти за `x-ratelimit-*` по кошиках, повтори, запис сирих відповідей),
`PinterestAdapter` (OAuth, профіль, дошки, піни з `pin_metrics`, аналітика акаунта з розбивкою `APP_TYPE`).
⚠️ Перевірити на PoC 2: назви ключів `pin_metrics`, формат відповіді з `split_field`.

## Синхронізація Pinterest (на основі PoC 1)

- **Первинна** (після підключення): профіль → піни (сторінками) → аналітика акаунта за 90 днів →
  метрики пінів.
- **Щоденна:** профіль, нові піни, аналітика за останні кілька днів (бо свіжі дні мають статус
  PROCESSING/ESTIMATE і уточнюються), lifetime-метрики пінів.
- **Ліміт аналітики 60 запитів/хв** → метрики пінів беремо пачками через `/pins?pin_metrics=true`,
  а не окремим запитом на кожен пін; адаптер читає `x-ratelimit-*` і пригальмовує.

## Питання на обговорення

0. ~~Структура простору~~ → вирішено: [ADR-0007](../decisions/0007-workspace-projects.md).

1. ~~Метрики в одній «довгій» таблиці~~ → вирішено: довга таблиця `MetricValue` як джерело правди +
   похідний шар і правила зберігання (див. «Обсяг і похідний шар»).
2. ~~Сирі відповіді API~~ → вирішено: **зберігаємо 90 днів** у `SyncPayload` (див. нижче).
3. ~~Дошки (boards)~~ → вирішено: легка таблиця `SocialBoard` одразу, аналітика — наша агрегація.
4. ~~Часові пояси~~ → вирішено: дні зберігаємо як віддає платформа (доба UTC), показуємо в часовому
   поясі **проєкту**; у UI підписуємо, що денні метрики — за добу UTC.
5. ~~Розбивка за пристроями~~ → вирішено: на рівні **акаунта** збираємо з першого дня
   (`split_field=APP_TYPE`, +1 запит на синхронізацію, `dimensions = {app_type}`); на рівні пінів — ні;
   показ у UI — пізніше. Перевірити параметр у PoC 2.

Усі рішення зведено в [ADR-0008](../decisions/0008-metrics-storage.md).
