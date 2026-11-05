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

## На чому зупинились

Потрібен developer app Pinterest — створює власник проєкту.

## Наступні кроки

1. Створити developer app на developers.pinterest.com.
2. PoC Pinterest API → `docs/integrations/pinterest.md`.
3. Паралельно можна почати етап 1 (скелет монорепо) — не залежить від Pinterest.

## Відкриті питання

- Інфраструктура на домашньому Proxmox: [plans/infra-discussion.md](plans/infra-discussion.md).

- Хостинг production — кандидат домашній Proxmox, вирішуємо на етапі 4.
- Etsy — майбутній напрям E-commerce Intelligence, поза MVP.
