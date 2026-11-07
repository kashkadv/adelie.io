# Інтеграція Instagram

- **Статус:** PoC пройдено на акаунті кав'ярні `adelie.if` (2026-11-07); далі — Gushka тестувальником, інтеграція
- **Порядок платформ:** друга після Pinterest ([ADR-0004](../decisions/0004-platform-order.md)), лише читання
- **Джерело:** офіційна документація Meta, `developers.facebook.com/docs/instagram-platform` (версія API v27.0).
  Пункти з позначкою ⚠ у документації суперечливі або не підтверджені — перевірити в PoC.

## PoC (2026-11-07) — що підтверджено насправді

Документація розходиться з кабінетом Meta; **діє цей розділ**, решта нижче — довідково.

- **Кабінет Meta (листопад 2026):** «Instagram login» замінено на **«API setup with Unified login»** — він вимагає
  **бізнес-портфоліо** (створено «Adelie», без верифікації) і працює через **Facebook Login for Business** з
  конфігураціями. Шаблонна конфігурація просить рекламу, публікацію, повідомлення й коментарі — створено власну
  **`Adelie read-only`** (ID 3320485304823445): асет — лише Instagram accounts (Asset Required), дозволи —
  `instagram_basic`, `instagram_manage_insights` (спершу додати їх у «Permissions and features» сценарію).
- **Токен:** system-user access token (`EAA…`), **без терміну дії**; працює на **`graph.facebook.com`** (не
  `graph.instagram.com` — там «Cannot parse access token»). Надані дозволи: `instagram_basic`,
  `instagram_manage_insights`, `public_profile`. Запити — до Instagram business ID (`17841445843555583` для
  adelie.if), `/me` повертає порожнього system user.
- **Тестувальник:** App roles → Roles → Add People → **Instagram Tester** → прийняти в Instagram (Apps and
  websites → Tester invites) → у кроці «Generate access tokens» додати акаунт → Generate token.
- **Redirect URI:** `https://dev-api.adelie.space/social/instagram/callback` (збережено).
- **Профіль:** `GET /{ig-id}?fields=username,name,biography,followers_count,follows_count,media_count,profile_picture_url`
  — працює (adelie.if: 415 підписників, 21 допис).
- **Публікації:** `/{ig-id}/media` — працює, **`media_product_type` доступний** (FEED / REELS / STORY), тож Reels
  відрізняємо. Дописи 2021–2022 років віддаються.
- **Статистика публікацій** — lifetime, працює **навіть для дописів 2021–2022** (reach, likes, comments, saved,
  shares; `views` для старих = 0, метрики ще не було). Карусель — на рівні контейнера.
- **Статистика акаунта:**
  - **не більше 30 днів в одному запиті** (`There cannot be more than 30 days between since and until`);
  - **історія — 2 роки** (не 90 днів, як у документації): `reach` віддається за 400 днів тому, за 730 — «Metrics
    data is available for the last 2 years»;
  - `time_series` (по днях) — **лише `reach` і `follower_count`**; `views`, `accounts_engaged`,
    `total_interactions`, `follows_and_unfollows`, `profile_links_taps` — тільки `total_value` за проміжок →
    щоденні значення = окремий запит на кожен день (усі `total_value`-метрики одним запитом);
  - розбивка `views` за `media_product_type`: POST / CAROUSEL_CONTAINER / STORY / REEL;
  - демографія (`follower_demographics`, breakdown country/city/age/gender) — працює (≥100 підписників).
- **Назви й описи метрик** API повертає локалізовано (українською — за мовою користувача токена).
- **Ліміти:** заголовок `x-business-use-case-usage` (тип `instagram`, `call_count` у %); за PoC (~20 запитів) —
  0–1 %.
- **Сторіс:** `/{ig-id}/stories` — працює (зараз 0 активних).

**Підключення через вхід (2026-11-07, перевірено на adelie.if):**

- Meta видає токен системного користувача **портфоліо, яке людина обрала у вікні входу**, і закріплює за ним
  обраний акаунт; ID акаунта — `GET /me/assigned_instagram_accounts` (у `debug_token` `target_ids` немає).
- **Якщо обрати портфоліо самого застосунку («Adelie») — акаунт не закріплюється** (список порожній, вручну
  призначити системного користувача теж не можна). Власні акаунти розробника — тримати в іншому портфоліо
  (adelie.if перенесено в «AWE dev»).
- Акаунт Instagram має бути в бізнес-портфоліо, до якого має доступ Facebook-акаунт, яким людина входить; акаунт,
  прив'язаний до сторінки Facebook, не можна вилучити з портфоліо, доки не відв'язати сторінку.
- `follower_count` (нові підписники) — **лише за останні 30 днів без сьогоднішнього**; інакше помилка 100.
- Перша синхронізація adelie.if: 96 запитів, 21 публікація, 840 значень метрик акаунта за 90 днів — SUCCESS.
- **Режим розробки (Standard access):** вхід через **Facebook** вимагає ролі в застосунку саме для цього
  Facebook-акаунта (інакше «Додаток неактивний»); роль Instagram Tester діє лише на акаунт Instagram, а вхід під
  Instagram-акаунтом без прав адміна портфоліо падає на «Save» («Could not connect Adelie»).
- **Gushka підключено «як агенція» (2026-11-07):** власник портфоліо «Ґушка» дав повний доступ Facebook-акаунту
  розробника (адмін застосунку) → посилання-запрошення під ним → портфоліо «Ґушка» → `gushka.wool`. Паролі не
  передавались. Перша синхронізація: SUCCESS, 111 запитів, 760 публікацій (319 фото, 256 каруселей, 185 відео),
  87 288 підписників, за 90 днів ~2,43 млн переглядів.
- **Особливості даних (Gushka):**
  - `/media` віддає **760** публікацій (усі ID різні), а `media_count` профілю — 734: профіль, схоже, не рахує
    частину Reels; беремо список публікацій;
  - **`views` рахуються лише для публікацій після 2 липня 2024** (старі фото й каруселі, а також відео до кінця
    2021 — `views = 0`): такий 0 зберігаємо як «немає даних» (`null`), не нуль;
  - охоплення старих Reels може бути набагато меншим за перегляди (Reels 2022: 162 тис. переглядів, охоплення
    302) — Meta зберігає охоплення обмежений час, а перегляди — за весь час.
- Після App Review (Advanced access) ролі не потрібні: клієнт входить сам своїм Facebook / Instagram.

**Наслідки для синхронізації:** первинна — профіль, усі публікації з lifetime-статистикою, `reach` і
`follower_count` по днях за 2 роки (24 запити по 30 днів), `total_value`-метрики по днях — за 90 днів (90 запитів,
далі щодня 1); щоденна — знімки lifetime-статистики публікацій (щоденна динаміка — різницею знімків), сторіс —
частіше за добу.

## Який API

**Instagram API with Instagram Login** (Business Login for Instagram):

- лише **професійні акаунти** — Business або Creator; особисті не підтримуються;
- **Facebook Page не потрібна** (на відміну від «Instagram API with Facebook Login»);
- запити — на `graph.instagram.com`.

⚠ Overview радить для нових інтеграцій «Unified Login»; перевірити, чи це змінює вибір. Instagram Login
обрано, бо не вимагає Facebook Page (у Gushka її може не бути).

## Доступ і перевірка застосунку

| Рівень | Для кого | Що потрібно |
|---|---|---|
| **Standard** (за замовчуванням) | власні акаунти або ті, що додані в застосунок як тестувальники / з роллю | нічого — **без App Review** |
| **Advanced** | будь-які акаунти (клієнти) | **App Review** (скринкаст на кожен дозвіл, тестові інструкції, іконка 1024×1024, privacy policy, категорія, бізнес-пошта) + **Business Verification** (юрособа) + щорічний Data Use Checkup |

- **Для Gushka вистачає Standard:** акаунт Gushka додаємо тестувальником.
- **Для клієнтів потрібен Advanced** → Business Verification вимагає юрособи; пов'язати з рішенням про ФОП/ТОВ
  (див. status.md, Terms of Service). Скільки триває review — у документації не вказано.
- Застосунок Meta має бути типу **Business**; тестовий акаунт Instagram має бути **публічним**.

## Дозволи (лише читання)

- `instagram_business_basic` — профіль, медіа, оновлення токена;
- `instagram_business_manage_insights` — статистика акаунта й публікацій
  (⚠ є в описі insights, але відсутній у переліку App Review);
- коментарі — лише `instagram_business_manage_comments` (окремого read-only дозволу немає) → **не беремо**,
  кількості коментарів дає `comments_count` медіа.

## OAuth і токени

- Згода: `https://www.instagram.com/oauth/authorize?client_id=<Instagram App ID>&redirect_uri=…&response_type=code&scope=…&state=…`
  (`client_id` — Instagram App ID, не Meta App ID). Код живе 1 год, одноразовий; у кінці `#_` — відрізати.
- Короткий токен (1 год): `POST https://api.instagram.com/oauth/access_token`.
- Довгий токен (**60 днів**): `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token…` — лише з сервера.
- Оновлення: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token…` — токен має бути
  старшим за 24 год і ще живим; кожне оновлення — ще 60 днів. Не оновили за 60 днів → лише повторний вхід.
  → worker оновлює заздалегідь, як для Pinterest.
- У налаштуваннях входу: OAuth redirect URI, **Deauthorize callback URL**, **Data deletion request URL**
  (формат запитів — перевірити).

## Дані

**Профіль:** `GET /me?fields=user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count`.

**Публікації:** `GET /<IG_ID>/media` (курсори `paging.cursors.after`); поля медіа: `caption`, `media_type`
(IMAGE / VIDEO / CAROUSEL_ALBUM), `media_url`, `thumbnail_url`, `permalink`, `timestamp`, `like_count`,
`comments_count`, `children`, `is_shared_to_feed`. ⚠ `media_product_type` (FEED / REELS / STORY) документовано
лише для Facebook Login — як відрізнити Reels, перевірити в PoC.

**Статистика акаунта** — `GET /<IG_ID>/insights`, `period=day`:

- метрики: `views` (заміна `impressions`, застарілої з квітня 2025), `reach`, `accounts_engaged`,
  `total_interactions`, `likes`, `comments`, `saves`, `shares`, `reposts`, `replies`, `profile_links_taps`,
  `follows_and_unfollows`; демографія — `follower_demographics`, `engaged_audience_demographics` (`period=lifetime`);
- `metric_type=time_series` (по днях) лише для частини метрик (`reach`); решта — `total_value` за проміжок;
- розбивки: `media_product_type`, `follow_type`, `contact_button_type`; демографія — вік, місто, країна, стать;
- **історія — 90 днів**; затримка до 48 год; порожній результат замість 0;
- менше **100 підписників** → немає демографії, `follows_and_unfollows`, `online_followers`.
- ⚠ максимальний проміжок одного запиту не вказано.

**Статистика публікацій** — `GET /<MEDIA_ID>/insights`:

- **лише lifetime** — щоденних значень на публікацію немає → щоденну динаміку будуємо зі своїх знімків
  (як для пінів до ADR-0013); зберігається до 2 років;
- допис: `views`, `reach`, `likes`, `comments`, `saved`, `shares`, `total_interactions`, `follows`,
  `profile_visits`, `profile_activity`;
- Reels: + `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate`;
- сторіс: `views`, `reach`, `shares`, `link_clicks`, `navigation`, `replies` — **лише 24 год** після публікації,
  вебхук для Instagram Login не підтримується → сторіс треба забирати частими запусками; менше 5 переглядачів — помилка;
- дочірні медіа каруселі статистики не мають (⚠ рівень каруселі — перевірити).

## Ліміти

`дзвінків за 24 год = 4800 × кількість показів контенту акаунта за 24 год` — на пару застосунок+акаунт, ковзне
вікно; заголовок `X-Business-Use-Case-Usage`, помилка `80002`. ⚠ мінімуму не вказано — для малого акаунта може
бути тісно; щоденна синхронізація має бути економною.

## Наслідки для Adelie

- Адаптер у `packages/platforms` (ADR-0011); `SocialPlatform.INSTAGRAM` у схемі вже є.
- Метрики — у спільні визначення (ADR-0008): `views`, `reach`, `saves`, `shares`, `likes`, `comments`,
  `total_interactions`; «Покази» Pinterest і `views` Instagram — **не одне й те саме** (порівнювати обережно).
- Щоденні метрики публікацій — зі знімків lifetime-значень (різниця між днями).
- Сторіс — окремий частіший запуск або «лише те, що встигли» (вирішити після PoC).

## Кроки

- [x] Застосунок Meta «Adelie» (тип Business), бізнес-портфоліо, «API setup with Unified login», конфігурація `Adelie read-only`
- [x] Тестувальник `adelie.if` (кав'ярня) — для PoC
- [ ] Акаунт Gushka (професійний, публічний) — тестувальник _(власник)_
- [x] Токен із кабінету — на сервері `~/adelie/env/instagram-poc.token` (лише для PoC)
- [x] PoC: профіль, медіа, insights акаунта й публікацій, глибина історії, ліміти (на adelie.if; Reels/сторіс — на Gushka)
- [x] Redirect URI `https://dev-api.adelie.space/social/instagram/callback`
- [ ] Deauthorize і data deletion URL
- [x] Адаптер, OAuth, запрошення, синхронізація (ADR-0015)
- [ ] «Огляд» і «Контент» для Instagram
