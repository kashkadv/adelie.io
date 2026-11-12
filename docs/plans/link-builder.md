# План: Link Builder

Рішення — [ADR-0027](../decisions/0027-link-builder.md).

- [x] Модель даних: `tracked_link`, `link_click` (міграція без змін наявних таблиць).
- [x] API: реєстр каналів, нормалізація міток, побудова повної адреси, код; створення / зміна / архів; список з
      кліками, візитами й цілями (Flipper) за період; підказки кампаній.
- [x] API: запис у Workers KV (якщо налаштовано Cloudflare); прийом кліків `POST /go/clicks`.
- [x] Worker `go.adelie.space` (`infra/go`): перенаправлення з KV, клік у фоні, боти; розгортання `pnpm deploy:go`.
- [x] Інтерфейс: Просування → «Посилання»: таблиця, створення й зміна у вікні, копіювання повної й короткої форми.
- [ ] Від власника: токен Cloudflare API → `~/adelie/env/dev.env`; розгорнути Worker; перевірити клік і перехід.

## Налаштування Cloudflare (один раз)

1. **Токен API** (dash.cloudflare.com → My Profile → API Tokens → Create Token → Custom token), дозволи:
   - Account → **Workers Scripts: Edit**, **Workers KV Storage: Edit**;
   - Zone `adelie.space` → **Workers Routes: Edit**, **DNS: Edit**.
2. **Account ID** — на головній сторінці акаунта Cloudflare (праворуч, «Account ID»).
3. На сервері дописати в `~/adelie/env/dev.env` (без показу значень):
   ```bash
   ssh -t adelie@adelie 'read -rp "CF_ACCOUNT_ID: " a; read -rsp "CF_API_TOKEN: " t; echo; \
     printf "CF_ACCOUNT_ID=%s\nCF_API_TOKEN=%s\nGO_CLICK_SECRET=%s\n" "$a" "$t" "$(openssl rand -hex 32)" \
     >> ~/adelie/env/dev.env'
   ```
4. `pnpm deploy:go` — створює KV `adelie-go-links`, завантажує Worker `adelie-go`, під'єднує `go.adelie.space`;
   виводить `GO_KV_NAMESPACE_ID=…` — дописати в `dev.env` і `pnpm deploy:dev`.
5. Перевірка: створити посилання → «Коротке» → відкрити в браузері → перехід і +1 клік.

Без кроків 1–4 Link Builder працює лише з повними посиланнями.
