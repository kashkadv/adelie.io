# Pinterest API

- **Статус:** етап 0 — застосунок `Adelie` (App ID `1635003`) подано 2026-11-05, Trial: очікування доступу.
  PoC 1 (порожній акаунт Adelie) виконано; PoC 2 (дані Gushka) — після схвалення.
- **Оновлено:** 2026-11-05

Позначки: ✅ — підтверджено офіційною специфікацією API, ⚠️ — з вторинних джерел
або припущення, перевірити на PoC.

## Джерела

- OpenAPI-специфікація v5 (офіційна, версія 5.28.0):
  https://github.com/pinterest/api-description/blob/main/v5/openapi.json
- Рівні доступу: https://developers.pinterest.com/docs/key-concepts/access-tiers/
- Rate limits: https://developers.pinterest.com/docs/reference/rate-limits/

## OAuth ✅

- Authorize: `https://www.pinterest.com/oauth/`
- Token: `POST https://api.pinterest.com/v5/oauth/token`
- Flow: authorization code.
- Тривалість життя access/refresh token — ⚠️ з'ясувати на PoC.

### Scopes для Adelie (лише читання)

| Scope | Навіщо |
|---|---|
| `user_accounts:read` | профіль, аналітика акаунта, підписники |
| `pins:read` | піни та аналітика пінів |
| `boards:read` | борди (потрібен і для `/pins`) |

Не запитуємо: `*:write`, `*_secret`, `ads:*`, `catalogs:*`, `billing:*`.
Секретні борди/піни (`*:read_secret`) — пізніше, якщо знадобиться.

### Розширення дозволів у майбутньому

Планується (поза MVP-1): публікація та планування пінів, рекламна аналітика / керування
рекламою (ТЗ 14.1). Тоді:

- оновити варіанти використання застосунку на developers.pinterest.com;
- запросити нові scopes: `pins:write`, `boards:write` (публікація), `ads:read` (рекламна аналітика),
  `ads:write` — лише якщо будемо керувати кампаніями;
- ймовірно, пройти додаткову перевірку Pinterest (демо нових функцій);
- оновити privacy policy (зараз вона обіцяє «лише читання») — користувачі повторно дають згоду
  на нові scopes під час перепідключення.

Поки запитуємо мінімум: так простіше пройти review, а заявка відповідає реальним функціям.

## Endpoints ✅

| Endpoint | Scopes | Що дає |
|---|---|---|
| `GET /v5/user_account` | user_accounts:read | профіль |
| `GET /v5/user_account/analytics` | user_accounts:read | щоденні метрики акаунта |
| `GET /v5/user_account/analytics/top_pins` | pins:read, user_accounts:read | топ до 50 пінів за метрикою |
| `GET /v5/user_account/analytics/top_video_pins` | те саме | топ відео-пінів |
| `GET /v5/pins` | boards:read, pins:read | список пінів (пагінація `bookmark`); `pin_metrics=true` — метрики за 90 днів і lifetime прямо в списку |
| `GET /v5/pins/{id}/analytics` | boards:read, pins:read | щоденні метрики піна |
| `GET /v5/boards` | boards:read | борди |
| `GET /v5/user_account/followers` | user_accounts:read | підписники |

### Метрики акаунта ✅

`IMPRESSION`, `ENGAGEMENT`, `ENGAGEMENT_RATE`, `PIN_CLICK`, `PIN_CLICK_RATE`,
`OUTBOUND_CLICK`, `OUTBOUND_CLICK_RATE`, `SAVE`, `SAVE_RATE`.

Фільтри/розбивки: `app_types` (mobile/tablet/web), `content_type` (paid/organic),
`pin_format`, `source`, `split_field`. Для органічної аналітики — `content_type=ORGANIC`.

Rates (`*_RATE`) — похідні значення, не сумуються (ТЗ 6.3).

## Обмеження, важливі для продукту

- ✅ **Історія — лише 90 днів.** `start_date` не може бути раніше ніж 90 днів тому.
  → При підключенні акаунта одразу забираємо 90 днів; далі щоденні snapshots — власна історія.
  У UI показуємо «дані доступні з <дата>».
- ✅ Lifetime-метрики пінів, створених до 2023-03-20, доступні лише для відео та Idea Pins.
- ⚠️ **Trial access: 1000 запитів на добу** на весь застосунок (вторинні джерела; у PoC 1 бачимо хвилинні ліміти — див. результати).
  → Для одного акаунта Gushka вистачає, якщо брати метрики пінів через `/pins?pin_metrics=true`
  (сторінками), а не окремим запитом на кожен пін.
- ⚠️ Trial: піни/борди, **створені** через API, — sandbox. Чи віддає trial реальну аналітику
  існуючого акаунта — перевірити на PoC.
- ⚠️ Чи може в trial підключатись акаунт, що не є власником застосунку, — перевірити.

## Рівні доступу ⚠️

- **Trial** — видається після схвалення застосунку. Для розробки та PoC.
- **Standard** — заявка з кабінету. Потрібні: схвалений trial, відповідність Developer Guidelines,
  **демо-відео** роботи застосунку з API (включно з OAuth-flow) — навіть якщо користувач лише один.
  Рев'ю ручне, строки не гарантовані.
- Публічна сторінка з privacy policy, ймовірно, обов'язкова → `adelie.space/privacy`.
- API безкоштовний.

## Хто власник застосунку

Developer-застосунок реєструється від **окремого business-акаунта Pinterest «Adelie»**
(пошта `hello@adelie.space`), а не від особистого акаунта чи акаунта клієнта.

- Акаунт розробника лише «володіє» реєстрацією (App ID, secret, налаштування, заявки на доступ).
  Даних клієнтів він не бачить.
- Клієнти (напр. Gushka) підключаються через OAuth у самому Adelie; токени й дані зберігаються
  на сервері Adelie у workspace клієнта. Один застосунок на всіх клієнтів.
- Окремий бренд-акаунт: застосунок не прив'язаний до особи, легко передати компанії.

Порядок: Email Routing для `adelie.space` → business-акаунт Pinterest «Adelie» → developer app.

## Як створити застосунок (виконує власник проєкту)

1. Увійти на https://developers.pinterest.com під business-акаунтом «Adelie».
2. **My apps → Connect app** (назва може відрізнятися): назва `Adelie`, опис
   «Marketing analytics: read-only access to account and Pin analytics».
   Анкета (2026-11-05):
   - ціль розробника — «Досвід споживача (бізнес, продавець, клієнти в масштабі)»;
   - варіанти використання — лише «Звіти»;
   - аудиторія — «Організації», «Продавці» (+ «Автори» за бажанням);
   - читає дані пінів/дошок — «Так, мої дані» (власні піни автентифікованого користувача).
3. Сайт: `https://adelie.space`; privacy policy: `https://adelie.space/privacy` ✅ опубліковано.
4. Дочекатись схвалення → trial access.
5. У налаштуваннях застосунку додати redirect URI (шлях за ТЗ §12 — `GET /social/:platform/callback`):
   - розробка: `http://localhost:4000/social/pinterest/callback`;
   - production: `https://api.adelie.space/social/pinterest/callback`.
   ✅ Обидва додано в кабінеті 2026-11-05 (localhost прийнято).
6. App ID і App secret **не комітити** — покласти на dev-сервер у `~/adelie/app.env`
   (підхопиться `pnpm env:pull`).

## Результати PoC

### PoC 1 — 2026-11-05, тестовий маркер, акаунт «Adelie» (порожній)

Скрипт: `scripts/pinterest-poc.sh` (запускається на сервері, маркер — у `~/adelie/poc.env`).
Маркер створено в кабінеті застосунку («Створення маркерів доступу», середовище
«Обмежене робоче середовище»), коли застосунок ще в статусі **Trial: очікування доступу**.
Такий маркер дає read-scopes для акаунта, що його створив.

✅ Підтверджено:

- API відповідає ще до схвалення trial (з тестовим маркером).
- `GET /user_account` → `account_type`, `username`, `business_name`, `website_url`,
  `follower_count`, `following_count`, `pin_count`, `board_count`, `monthly_views`.
  **`monthly_views: -1` = недоступно**, не нуль → зберігати як «немає даних».
- `/boards`, `/pins`, `/user_account/followers` — пагінація через `bookmark` (`null` — кінець).
- **Ліміт історії 90 днів підтверджено:** запит на 120 днів → `400 {"code":1,"message":"You can only get data from the last 90 days."}`.
- **Щоденні метрики мають `data_status` на кожен день** — офіційна ознака повноти даних:
  `READY`, `PROCESSING`, `ESTIMATE`, `BEFORE_BUSINESS_CREATED`, `BEFORE_DATA_RETENTION_PERIOD`,
  `BEFORE_PIN_CREATED`, `BEFORE_ACCOUNT_CLAIMED`, … (повний enum `DataStatus` у специфікації).
  → Зберігати статус разом зі значенням; не-`READY` у UI — «немає даних / оцінка / обробляється» (ТЗ 6.4).
- `top_pins` повертає `date_availability` — діапазон, за який є дані.
- **Rate limits (з заголовків `x-ratelimit-*`, на пару застосунок+користувач):**
  - safety net: 100 запитів / 1 с;
  - читання (`org_read`): 1000 / 60 с;
  - аналітика (`org_analytics`): **60 / 60 с** ← найвужче місце для синхронізації;
  - followers рахується в окремий кошик `ads_read`.
  Заголовки: `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` (с) — адаптер має
  їх читати й пригальмовувати (ТЗ 8.3).
- ⚠️ «1000 запитів на добу» для trial з вторинних джерел **не підтвердилось** у заголовках —
  бачимо хвилинні вікна. Можливий окремий добовий ліміт — стежити.

Не перевірено (порожній акаунт): реальні значення метрик, `pin_metrics` у `/pins`,
`/pins/{id}/analytics`, типи пінів, глибина lifetime-метрик. → PoC 2 на акаунті Gushka після схвалення trial.

✅ Тестовий маркер PoC 1 (потрапив в історію чату) відкликано 2026-11-05: Pinterest → Налаштування акаунта
Adelie → підключені програми → Adelie → «Заборонити доступ». Перевірено: API повертає 401; файл
`~/adelie/poc.env` видалено з сервера.

Примітки:
- `POST /v5/oauth/token/revoke` для звичайних (не system user) токенів не спрацював:
  `401 {"code":1201,"message":"Two-factor authentication required."}` — потребує 2FA на акаунті-власнику.
- Тестовий маркер має ширші scopes (`ads:read`, `catalogs:read`), ніж ми запитуватимемо в OAuth.
