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
| [guides/flipper.md](guides/flipper.md) | Flipper: швидкий старт (встановлення, події магазину й оплата, згода, два домени, джерела) |
| [specs/promotion-strategy.md](specs/promotion-strategy.md) | План просування: ціль, стратегія, календар, поради що публікувати (чернетка) |
| [specs/product-factory.md](specs/product-factory.md) | Product Factory: цифрові продукти для Etsy — ніша → AI-продукт → Etsy → просування (задум) |
| [specs/pebble.md](specs/pebble.md) | Pebble: пошук трендів і комерційних можливостей (ідея, формат не визначено) |
| [plans/mvp-1.md](plans/mvp-1.md) | План MVP-1: Pinterest end-to-end (в роботі) |
| [plans/link-builder.md](plans/link-builder.md) | Link Builder: кроки реалізації (готово) |
| [plans/content-calendar.md](plans/content-calendar.md) | Календар публікацій і огляд тижня (в роботі) |
| [plans/stage-2-data-model.md](plans/stage-2-data-model.md) | Етап 2: модель даних соцмереж і метрик (узгоджено) |
| [plans/mvp-discussion.md](plans/mvp-discussion.md) | Обговорення обсягу MVP і стеку (завершено) |
| [plans/infra-discussion.md](plans/infra-discussion.md) | Обговорення інфраструктури на домашньому Proxmox (в роботі) |
| [infra/local-llm.md](infra/local-llm.md) | Локальна LLM на робочому ПК: що потягне залізо, GPU-воркер за потреби, перевірка якості (план) |
| [infra/server-setup.md](infra/server-setup.md) | Сервер на Proxmox: створення VM, доступ, журнал налаштування |
| [infra/backups.md](infra/backups.md) | Резервні копії бази dev: щонічний дамп з перевіркою відновлення, копії на хост і поза домом |
| [integrations/pinterest.md](integrations/pinterest.md) | Pinterest API: scopes, endpoints, метрики, обмеження, як створити застосунок |
| [integrations/tiktok.md](integrations/tiktok.md) | TikTok (Login Kit + Display API): застосунок, sandbox, дозволи, реалізація, тексти й сценарій для App Review |
| [integrations/instagram.md](integrations/instagram.md) | Instagram API (Instagram Login): доступ, дозволи, метрики, обмеження, кроки |

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
- [ADR-0015](decisions/0015-instagram-integration.md) — Інтеграція Instagram (прийнято)
- [ADR-0016](decisions/0016-user-preferences.md) — Налаштування інтерфейсу користувача (прийнято)
- [ADR-0017](decisions/0017-instagram-post-daily.md) — Щоденні метрики публікацій Instagram із різниці знімків (прийнято)
- [ADR-0018](decisions/0018-promotion-and-sales.md) — Джерела даних: просування й продажі (прийнято)
- [ADR-0019](decisions/0019-connection-access-levels.md) — Рівні доступу підключень (прийнято)
- [ADR-0020](decisions/0020-connection-features-update-access.md) — Функції підключення й «Оновити доступ» (прийнято)
- [ADR-0021](decisions/0021-website-catalog-feeds.md) — Каталог сайтів через фід Google Merchant, кілька сайтів-ринків (прийнято)
- [ADR-0022](decisions/0022-flipper-tracker.md) — Flipper: трекер подій сайту (прийнято)
- [ADR-0023](decisions/0023-tiktok-integration.md) — Інтеграція TikTok: статистика, публікація, редагування (запропоновано)
- [ADR-0024](decisions/0024-promotion-strategy-module.md) — Модуль «План просування»: AI-помічник за даними, OpenAI (прийнято)
- [ADR-0025](decisions/0025-own-tool-first.md) — Adelie — власний інструмент на цьому етапі: що відкладаємо, критерії перевірки (прийнято)
- [ADR-0026](decisions/0026-flipper-site-goals.md) — Flipper: тип сайту, цілі й воронка як налаштування (прийнято)
- [ADR-0027](decisions/0027-link-builder.md) — Link Builder: мічені й короткі посилання (`go.adelie.space`) (прийнято)
- [ADR-0028](decisions/0028-content-calendar.md) — Календар публікацій і огляд тижня (прийнято)
- [ADR-0029](decisions/0029-ai-brief-and-ideas.md) — Бриф проєкту й ідеї AI для календаря (прийнято)
