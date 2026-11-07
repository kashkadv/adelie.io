# Документація Adelie

Уся інформація про проєкт живе в цій папці. Як запустити код — [README у корені](../README.md). Почни з [rules.md](rules.md) і [status.md](status.md).

| Документ | Опис |
|---|---|
| [rules.md](rules.md) | Правила роботи над проєктом |
| [status.md](status.md) | Поточний статус, наступні кроки, відкриті питання |
| [product-requirements.md](product-requirements.md) | Вимоги до продукту та технічне завдання (v1.1) |
| [decisions/](decisions/) | Архітектурні рішення (ADR) |
| [plans/](plans/) | Плани реалізації |
| [specs/tracker.md](specs/tracker.md) | Adelie Tracker: події на сайті, джерела трафіку, атрибуція (концепція) |
| [specs/pebble.md](specs/pebble.md) | Pebble: пошук трендів і комерційних можливостей (ідея, формат не визначено) |
| [plans/mvp-1.md](plans/mvp-1.md) | План MVP-1: Pinterest end-to-end (в роботі) |
| [plans/stage-2-data-model.md](plans/stage-2-data-model.md) | Етап 2: модель даних соцмереж і метрик (узгоджено) |
| [plans/mvp-discussion.md](plans/mvp-discussion.md) | Обговорення обсягу MVP і стеку (завершено) |
| [plans/infra-discussion.md](plans/infra-discussion.md) | Обговорення інфраструктури на домашньому Proxmox (в роботі) |
| [infra/server-setup.md](infra/server-setup.md) | Сервер на Proxmox: створення VM, доступ, журнал налаштування |
| [integrations/pinterest.md](integrations/pinterest.md) | Pinterest API: scopes, endpoints, метрики, обмеження, як створити застосунок |

## Рішення (ADR)

- [ADR-0001](decisions/0001-docs-as-source-of-truth.md) — Документація в репозиторії як єдине джерело правди
- [ADR-0002](decisions/0002-stack-and-monorepo.md) — Стек і структура монорепо (прийнято)
- [ADR-0003](decisions/0003-auth.md) — Автентифікація: Better Auth (прийнято)
- [ADR-0004](decisions/0004-platform-order.md) — Порядок підключення платформ: Pinterest першим (прийнято)
- [ADR-0005](decisions/0005-toolchain.md) — Інструменти та версії (прийнято)
- [ADR-0006](decisions/0006-i18n.md) — Мультимовність інтерфейсу: next-intl, en + uk (прийнято)
- [ADR-0007](decisions/0007-workspace-projects.md) — Структура простору: workspace → проєкти → акаунти (прийнято)
- [ADR-0008](decisions/0008-metrics-storage.md) — Зберігання метрик: довга таблиця, похідний шар, сирі відповіді 90 днів (прийнято)
- [ADR-0009](decisions/0009-design-system.md) — Дизайн-система: пінгвінячі тони, скло, сайдбар, Inter (прийнято)
- [ADR-0010](decisions/0010-personal-profile.md) — Профіль користувача: ім'я, посада, фото, контакти, робочий час (прийнято)
- [ADR-0011](decisions/0011-platform-adapters.md) — Контракт адаптера платформ (прийнято)
- [ADR-0012](decisions/0012-connect-invitations.md) — Запрошення на підключення акаунта (прийнято)
- [ADR-0013](decisions/0013-post-daily-metrics.md) — Щоденні метрики публікацій і метрики за період (прийнято)
- [ADR-0014](decisions/0014-project-management.md) — Керування проєктами й налаштування проєкту (прийнято)
