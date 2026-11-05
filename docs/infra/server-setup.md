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
- Розгорнуто `infra/edge` (cloudflared + caddy): лендінг і privacy policy на https://adelie.space.

## Відтворення VM з нуля (на хості Proxmox)

```bash
qm create 104 --name adelie --ostype l26 --machine q35 --cpu host --cores 4 \
  --memory 4096 --balloon 2048 --net0 virtio,bridge=vmbr0 \
  --scsihw virtio-scsi-single --agent enabled=1 --onboot 1
qm set 104 --scsi0 local-lvm:0,import-from=/var/lib/vz/import/noble-server-cloudimg-amd64.img,discard=on,iothread=1,ssd=1
qm resize 104 scsi0 60G
qm set 104 --ide2 local-lvm:cloudinit --boot order=scsi0 --serial0 socket --vga serial0
qm set 104 --ciuser adelie --sshkeys <keys.pub> --ipconfig0 ip=dhcp
qm start 104
```

Далі: apt upgrade, qemu-guest-agent, Docker (get.docker.com), Tailscale, ufw — як вище.
