# TikTok: Login Kit + Display API (етап 1, лише читання)

**Статус (2026-11-12):** етап 1 реалізовано й працює на dev у sandbox ([ADR-0023](../decisions/0023-tiktok-integration.md)):
вхід, шифрування токенів, оновлення токена, профіль зі статистикою, список публічних відео з лічильниками.
Перевірка таблиці з відео чекає на відео в тестовому акаунті. **Заявка на App Review ще не подана** (потрібне демо-відео).

## 1. Застосунок у TikTok for Developers (зроблено)

- Акаунт розробника на `developers.tiktok.com`, застосунок **Adelie**, категорія Business, опис (≤120 символів):
  `Marketing analytics dashboard for creators and small businesses: track content performance in one place.`
- Іконка — PNG 1024×1024 (білий фон, темний силует пінгвіна; генерується з `assets/brand/penguin-original.svg`).
- URL: Terms `https://adelie.space/terms`, Privacy `https://adelie.space/privacy`, Web `https://adelie.space`.
- **Підтвердження домену** `adelie.space` (Domain → DNS record): TXT-запис у Cloudflare DNS, ім'я `@`,
  значення `tiktok-developers-site-verification=B2TgjWOGrmZc7at6mJbVspYBwIWqFI4K`. Підтверджується власність над усіма
  адресами під доменом і його піддоменами (зокрема `dev.adelie.space`). Запис не секретний і не впливає на пошту
  (SPF-запис лишається поруч).
- **Sandbox `adelie-dev`:** окремі client key і secret, свій набір продуктів, лише тестові користувачі (Target Users:
  `tacho.mod`, `nilsolav`, `user737483586922`). Тестовий користувач — звичайний акаунт TikTok (не TikTok for Business);
  його створення/вхід завершується в мобільному застосунку.
- **Продукти:** лише **Login Kit** (Display API окремою карткою в порталі немає). **Redirect URI (Web):**
  `https://dev-api.adelie.space/social/tiktok/callback`.
- **Дозволи:** `user.info.basic` (входить у Login Kit), `user.info.profile`, `user.info.stats`, `video.list`.
  Content Posting API, Share Kit, Webhooks **не додавали**: форма перевірки вимагає показати у відео кожен вибраний
  продукт і дозвіл, зайве затримує розгляд.

## 2. Ключі

На сервері в `~/adelie/env/dev.env`: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` (зараз від **sandbox**). Після
схвалення застосунку будуть бойові ключі: замінити ними значення, вхід стане доступний усім, а не лише тестовим
користувачам. Ключі не пишуться в чат і репозиторій; `docker compose` передає env-файл усім службам.

## 3. Як це реалізовано

- Адаптер: `packages/platforms/src/tiktok/` (`adapter.ts`, `mapping.ts`, `tiktok.spec.ts`, 12 тестів).
  OAuth: `https://www.tiktok.com/v2/auth/authorize/`, токен `POST https://open.tiktokapis.com/v2/oauth/token/` (форма, плоска
  відповідь; помилки можуть приходити зі статусом 200). Дані: `GET /v2/user/info/` (поля за дозволами, запасний варіант
  лише з базовими полями), `POST /v2/video/list/` (по 20, курсор).
- Доступовий токен живе добу (оновлюється при кожній синхронізації), оновлювальний — рік (може змінюватись).
- Метрики (довідник, міграція `20261112120000`): профіль — `follower_count`, `likes_count`, `video_count` (SNAPSHOT); відео —
  `view_count`, `like_count`, `comment_count`, `share_count` (LIFETIME) → наші `views`, `likes`, `comments`, `shares`.
- **Денні значення по відео** Adelie рахує сама з різниці підсумків між синхронізаціями (ADR-0017), тож історія накопичується
  лише з дня підключення. Денного ряду акаунта Display API не дає.
- Інтерфейс: «Підключення» → «Підключити» → TikTok (також посилання-запрошення), «Контент» → TikTok (перегляди, лайки,
  коментарі, поширення, дата), картка відео з графіками.

## 4. Обмеження

- `video.list` віддає лише **публічні** відео; у sandbox видно тільки тестових користувачів.
- Адреси **обкладинок** підписані й діють години: оновлюються з кожною синхронізацією, між ними мініатюра може зникати.
- Статистики «по днях» і демографії у Display API немає (демографія — окремо, Accounts API для Business-акаунтів; не робили).
- Публікація й редагування: `Content Posting API` — окремий етап (ADR-0023); опублікований пост через API не змінюється.

## 5. Заявка на App Review (ще не подана)

Порядок: демо-відео у sandbox → вибрати в основній формі (Production) ті самі продукти й дозволи → текст нижче → подати.
Розгляд від кількох днів до двох тижнів.

**Текст для поля «Explain how each product and scope works» (до 1000 символів):**

> Adelie is a marketing analytics dashboard for creators and small businesses. Login Kit: the user connects their own TikTok account via "Connect TikTok" (OAuth); tokens are stored encrypted and used only for that user's data. Scopes: user.info.basic shows the account name and avatar in the Connections list; user.info.profile shows the bio and profile link on the account card; user.info.stats shows follower, following, like and video counts on the overview; video.list lists the user's public videos with view, like, comment and share counts in the Content table, so the user can compare posts and track changes over time. Data is shown only to the user and members of their own workspace, is never sold or shared, and the user can disconnect at any time, which deletes the tokens. Adelie only reads data: it does not post, edit or delete content. The app runs on dev.adelie.space, a subdomain of the verified domain adelie.space.

**Демо-відео** (mp4/mov, до 5 файлів по 50 МБ; показати сайт, на якому інтегровано; домен у відео має збігатися з Web URL):

1. Сайт `adelie.space`: лендінг, політика конфіденційності й умови (у кадрі видно адресу).
2. Застосунок (`dev.adelie.space`): вхід в Adelie → «Підключення» → «Підключити» → TikTok.
3. Сторінка TikTok: вхід тестовим акаунтом, екран згоди з усіма чотирма дозволами.
4. Повернення в Adelie: акаунт з'явився (ім'я, аватар, підписники — `user.info.basic/profile/stats`).
5. «Контент» → TikTok: список публічних відео з переглядами, лайками, коментарями, поширеннями (`video.list`); картка відео.
6. «Від'єднати» акаунт: показати, що доступ відкликається.

Потрібні в тестовому акаунті **публічні відео** (без них крок 5 порожній). Перед відправкою в основній формі прибрати зайві
продукти й дозволи.

## 6. Далі

- Додати тестове відео в `tacho.mod`, перевірити таблицю й картку (добові графіки з другої синхронізації).
- Записати демо-відео й подати заявку; після схвалення замінити sandbox-ключі бойовими.
- Окремою ревізією, коли буде форма публікації: Content Posting API (`video.upload`, потім `video.publish`), аудит публікації
  (до нього пости лише приватні). Ліміти запитів і умови аудиту звірити в порталі.
