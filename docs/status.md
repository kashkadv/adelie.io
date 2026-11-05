# Статус проєкту

_Оновлено: 2026-11-05_

## Поточний етап

**MVP-1, етап 0** — перевірка Pinterest API. План: [plans/mvp-1.md](plans/mvp-1.md).
Коду ще немає.

## Зроблено

- Репозиторій `kashkadv/adelie.io` (монорепо), правила роботи: [rules.md](rules.md).
- Вимоги до продукту: [product-requirements.md](product-requirements.md).
- Обговорення MVP завершено: [plans/mvp-discussion.md](plans/mvp-discussion.md).
- Рішення: стек (ADR-0002), auth — Better Auth (ADR-0003), Pinterest першим (ADR-0004).
- Перший користувач — Gushka (Instagram, Pinterest, Etsy).
- Домен продукту: `adelie.space` (DNS переноситься на Cloudflare). Приватна мережа: Tailscale.
- Dev-сервер: VM `adelie` на домашньому Proxmox (Docker, Tailscale, ufw) — [infra/server-setup.md](infra/server-setup.md).

## На чому зупинились

Dev-сервер готовий (порожній, лише Docker). Потрібен developer app Pinterest — створює власник проєкту.
Активація DNS `adelie.space` на Cloudflare — в процесі.

## Наступні кроки

1. Створити developer app на developers.pinterest.com.
2. PoC Pinterest API → `docs/integrations/pinterest.md`.
3. Етап 1: скелет монорепо; Postgres + Redis на dev-сервері.
4. Закріпити IP `192.168.3.158` за VM на роутері (DHCP reservation).
5. Додати SSH-ключ стаціонарного ПК на сервер.

## Відкриті питання

- Інфраструктура на домашньому Proxmox: [plans/infra-discussion.md](plans/infra-discussion.md).

- Хостинг production — кандидат домашній Proxmox, вирішуємо на етапі 4.
- Etsy — майбутній напрям E-commerce Intelligence, поза MVP.
