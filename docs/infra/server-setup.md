# Сервер Adelie на домашньому Proxmox

Що і як налаштовано. Секрети (ключі, паролі, токени) сюди не пишемо.

## Поточний стан

| Параметр | Значення |
|---|---|
| Хост Proxmox | `pve`, `192.168.3.69` (UI: `:8006`), Proxmox VE 9.2, у tailnet |
| VM | ID `104`, ім'я `adelie`, автозапуск з хостом |
| ОС | Ubuntu Server 24.04 LTS (cloud image + cloud-init) |
| Ресурси | 4 vCPU, 4 GB RAM (balloon min 2 GB), 60 GB диск на `local-lvm` |
| LAN IP | `192.168.3.158` (закріплено на роутері за MAC `BC:24:11:EF:A6:F7`) |
| Tailscale | `adelie` / `100.102.237.81` |
| Користувач | `adelie` (sudo без пароля, група `docker`) |
| Часовий пояс | Europe/Kyiv |
| Cloudflare Tunnel | `adelie` (`1ff90529-f842-46e1-ad6c-3349752468b3`) → `adelie.space`, `www.adelie.space` |

Ресурси хоста обмежені: 13 GB RAM, з них ~4 GB — Home Assistant, плюс LXC
`backend`, `gateway`, `media-stack` (не стосуються Adelie, не чіпати).

## Доступ

SSH лише за ключами. Авторизовані ключі: ключі GitHub-акаунта `kashkadv`
+ `id_ed25519` з Mac.

```bash
ssh adelie@adelie              # через Tailscale (будь-де)
ssh adelie@192.168.3.158       # з домашньої мережі
```

Додати ключ нового ПК: з машини, що вже має доступ,
`ssh adelie@adelie 'cat >> ~/.ssh/authorized_keys' < ~/.ssh/<key>.pub`.

## Firewall (ufw)

- Вхідні за замовчуванням заборонені.
- SSH (22) — лише з `192.168.3.0/24`.
- Усе на інтерфейсі `tailscale0` — дозволено.

**Увага:** Docker обходить ufw для опублікованих портів. У compose публікувати
порти лише на `127.0.0.1` або Tailscale IP (`100.102.237.81:5432:5432`),
ніколи не на `0.0.0.0`.

## Встановлено

- qemu-guest-agent, unattended-upgrades, ufw
- Docker Engine 29.x + compose plugin (get.docker.com)
- Tailscale 1.104
- cloudflared 2026.10 (apt, pkg.cloudflare.com) — для керування тунелем; сам тунель працює в Docker

## Публічний доступ (Cloudflare Tunnel)

Стек `infra/edge/` (docker compose `adelie-edge`): `cloudflared` + `caddy` зі статичним сайтом
`apps/site/`. Портів назовні не публікує — трафік приходить лише через тунель.

- Конфіг тунелю: `infra/edge/cloudflared.yml` (hostname → сервіс).
- Секрети на сервері, не в репо: `~/.cloudflared/cert.pem` (керування тунелями й DNS зони
  `adelie.space`) і `~/.cloudflared/<tunnel-id>.json` (credentials тунелю).
- Деплой сайту і конфігу: `pnpm deploy:edge` (rsync на сервер + `docker compose up`).
- Кеш: Cloudflare кешує статику. Деплой додає до посилань на CSS/JS/SVG/іконки `?v=<хеш>`
  (лише в копії на сервері) — нова версія видна одразу; HTML кешується 5 хв.
- Новий піддомен: `ssh adelie@adelie cloudflared tunnel route dns adelie <host>`,
  додати правило в `cloudflared.yml`, `pnpm deploy:edge`.
- В акаунті Cloudflare є інший тунель — «Proxmox Home Tunnel» — він не стосується Adelie, не чіпати.

## Пошта домену

Cloudflare Email Routing (лише прийом, переадресація): `hello@adelie.space`, `privacy@adelie.space`
→ Gmail власника. MX/SPF-записи додає Cloudflare автоматично. Надсилати листи від імені
домену Email Routing не вміє — для цього знадобиться окремий SMTP-сервіс (пізніше).

## Журнал налаштування

### 2026-11-05

- Додано SSH-ключ Mac (`id_ed25519`) у `root` хоста Proxmox (власником).
- Завантажено Ubuntu 24.04 cloud image у `/var/lib/vz/import/` на хості.
- Створено VM 104 `adelie` (`qm create` + import-from cloud image + cloud-init:
  користувач `adelie`, SSH-ключі, DHCP).
- Оновлено систему, встановлено qemu-guest-agent, Docker, Tailscale,
  timezone Europe/Kyiv.
- VM авторизовано в tailnet як `adelie`.
- Увімкнено ufw (правила вище).
- Postgres 18 + Redis 8 (`infra/dev/`, секрети згенеровано на сервері), перша міграція.
- Встановлено cloudflared, авторизовано на зону `adelie.space` (`cloudflared tunnel login`, власник).
- Створено тунель `adelie`, CNAME `adelie.space` і `www.adelie.space` → тунель.
- `~/adelie/app.env` (секрети застосунку, 0600): BETTER_AUTH_SECRET, TOKEN_ENCRYPTION_KEY,
  PINTEREST_APP_ID/SECRET (секрет вставлено власником через `ssh -t … read -rs`). `pnpm env:pull` копіює їх у `.env`.
- Розгорнуто `infra/edge` (cloudflared + caddy): лендінг і privacy policy на https://adelie.space.
- Увімкнено Cloudflare Email Routing (власник): `hello@`, `privacy@` → Gmail. MX, SPF, DKIM на місці;
  DMARC поки немає — додати, коли почнемо надсилати пошту від домену.

- 2026-11-07: збірка образу (Next.js) на VM з 1,8 ГБ і без swap вичерпала пам'ять — VM зависла на кілька хвилин.
  Пам'ять закріплено: `qm set 104 --balloon 4096` (мінімум = максимум = 4 ГБ); у VM — swap 4 ГБ
  (`/swapfile` у `/etc/fstab`, `vm.swappiness=10`). Згодом — збирати образи поза сервером (CI).

## Відтворення VM з нуля (на хості Proxmox)

```bash
qm create 104 --name adelie --ostype l26 --machine q35 --cpu host --cores 4 \
  --memory 4096 --balloon 4096 --net0 virtio,bridge=vmbr0 \
  --scsihw virtio-scsi-single --agent enabled=1 --onboot 1
qm set 104 --scsi0 local-lvm:0,import-from=/var/lib/vz/import/noble-server-cloudimg-amd64.img,discard=on,iothread=1,ssd=1
qm resize 104 scsi0 60G
qm set 104 --ide2 local-lvm:cloudinit --boot order=scsi0 --serial0 socket --vga serial0
qm set 104 --ciuser adelie --sshkeys <keys.pub> --ipconfig0 ip=dhcp
qm start 104
# у VM: swap 4 ГБ
# sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
# echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
```

Далі: apt upgrade, qemu-guest-agent, Docker (get.docker.com), Tailscale, ufw — як вище.

## Застосунок на сервері: оточення `dev` (2026-11-06)

https://dev.adelie.space (веб) і https://dev-api.adelie.space (API) — через той самий Cloudflare Tunnel.

- **Код:** `infra/app/Dockerfile` (один образ: api, web, worker, міграції) і `infra/app/docker-compose.yml`
  (проєкт `adelie-app-dev`). Портів назовні немає: веб і API доступні тунелю в мережі `adelie-edge_default`
  (аліаси `dev-web`, `dev-api`), база й Redis — у мережі `adelie-dev_default`.
- **Деплой:** `pnpm deploy:dev` — відправляє закомічений `HEAD` (`git archive`) у `~/adelie/app/dev/src`,
  збирає образ на сервері (~2 хв), запускає міграції, потім api/web/worker. Незакомічені зміни — відмова.
- **Секрети:** `~/adelie/env/dev.env` (0600) — окремі `BETTER_AUTH_SECRET` і `TOKEN_ENCRYPTION_KEY`, база
  `adelie_dev`, Redis DB `1`, ключі Pinterest з `app.env`. Локальна розробка й далі працює з базою `adelie`.
- **Доступ:** сайт публічний, але реєстрація лише для пошт із `SIGNUP_ALLOWLIST` (у `dev.env`); вхід обмежено
  5 спробами за хвилину; `noindex`. Cookie сесії — `__Secure-adelie-dev.session_token` на `adelie.space`.
- **Тунель:** маршрути в `infra/edge/cloudflared.yml`; DNS — `cloudflared tunnel route dns adelie <host>`.
  Після зміни конфігу тунелю: `pnpm deploy:edge` і перезапуск `cloudflared`
  (`docker compose restart cloudflared` у `~/adelie/infra/edge`).
- **Журнали:** `docker logs adelie-app-dev-api-1` (так само `-web-1`, `-worker-1`, `-migrate-1`).

