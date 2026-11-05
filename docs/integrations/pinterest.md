# Pinterest API

- **Статус:** етап 0 — дослідження. PoC ще не виконано.
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
- ⚠️ **Trial access: 1000 запитів на добу** на весь застосунок.
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
3. Сайт: `https://adelie.space`; privacy policy: `https://adelie.space/privacy` ✅ опубліковано.
4. Дочекатись схвалення → trial access.
5. У налаштуваннях застосунку додати redirect URI для розробки:
   `http://localhost:4000/integrations/pinterest/callback` ⚠️ (перевірити, що localhost дозволений).
6. App ID і App secret **не комітити** — покласти на dev-сервер у `~/adelie/app.env`
   (підхопиться `pnpm env:pull`).

## Результати PoC

_(заповнюється після етапу 0)_
