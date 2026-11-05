# Сервер Adelie на домашньому Proxmox

Інструкція створення VM і доступу. Секрети (ключі, паролі, токени) сюди не пишемо.

## 1. Створення VM (вручну, через Proxmox UI)

- ОС: **Ubuntu Server 24.04 LTS** (ISO з ubuntu.com).
- Ім'я VM: `adelie`.
- Ресурси (старт): 2–4 vCPU, 6–8 GB RAM, 60 GB диск. Можна збільшити пізніше.
- Опції: увімкнути **QEMU Guest Agent**.
- Під час встановлення Ubuntu:
  - username: `adelie`;
  - увімкнути **Install OpenSSH server**;
  - **Import SSH identity → from GitHub**, username `kashkadv` — ключі з GitHub
    одразу дадуть SSH-доступ з усіх ПК, де ці ключі є.

## 2. Tailscale у VM

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh=false
```

Відкрити посилання з виводу, авторизувати в тому ж tailnet, що й ПК.
У консолі Tailscale перейменувати машину на `adelie` (MagicDNS-ім'я).

## 3. Доступ

З будь-якого ПК у tailnet:

```bash
ssh adelie@adelie
```

Далі налаштування VM (Docker, firewall, сервіси) виконується через SSH і
документується нижче.

## Журнал налаштування

_(заповнюється в міру роботи)_
