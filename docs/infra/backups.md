# Резервні копії бази dev

Пріоритет за [ADR-0025](../decisions/0025-own-tool-first.md): частина даних існує лише в нашій базі — історія старша за
90 днів, щоденні метрики Instagram (з різниці знімків), журнал змін товарів, події Flipper. Платформи її вже не віддадуть.

## Що робиться

**1. Щоночі на VM** (`infra/dev/backup/backup.sh`, таймер `adelie-backup.timer`, 02:30 UTC — до синхронізації о 04:00):
- `pg_dump -Fc` бази `adelie_dev` з контейнера `adelie-dev-postgres-1` → `~/backups/daily/adelie_dev-YYYY-MM-DD.dump`;
- **перевірка відновлення щоразу:** дамп відновлюється в тимчасову базу `adelie_dev_restore_check`, кількість рядків
  ключових таблиць (`social_account`, `social_post`, `post_metric_daily`, `account_metric_value`, `shop_order`,
  `shop_ledger_entry`) звіряється з робочою базою, тимчасова база видаляється. Невдала перевірка → код виходу 1
  (видно в `systemctl status adelie-backup`), дамп лишається; результат — `~/backups/last-check.txt`, час останньої
  успішної копії — `~/backups/last-ok`;
- у неділю — копія в `~/backups/weekly/`; зберігаються 7 щоденних і 4 тижневі.

**2. Копія на хост Proxmox** — хост сам забирає теку `~/backups` з VM (rsync через SSH із ключем, обмеженим на
читання цієї теки, `rrsync -ro`). Копії на хості не видаляються разом із VM-копіями: якщо щось станеться з VM, хост
зберігає своє.

**3. Копія поза домом** — ще не вирішено (див. «Відкрите»).

Розмір (2026-11-12): база 46 МБ, дамп 7,3 МБ (перевірка відновлення — ~5 с).

## Встановлення на VM

```bash
# з репозиторію (на Mac)
ssh adelie@adelie 'mkdir -p ~/adelie/backup'
scp infra/dev/backup/backup.sh adelie@adelie:adelie/backup/backup.sh
scp infra/dev/backup/adelie-backup.{service,timer} adelie@adelie:/tmp/

# на VM
sudo install -m 644 /tmp/adelie-backup.service /tmp/adelie-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now adelie-backup.timer
sudo systemctl start adelie-backup.service      # перший запуск одразу
systemctl list-timers adelie-backup.timer       # коли наступний
journalctl -u adelie-backup -n 20               # журнал
```

## Відновлення

```bash
# на VM: у нову базу (перевірити) …
docker exec adelie-dev-postgres-1 createdb -U adelie adelie_restored
docker exec -i adelie-dev-postgres-1 pg_restore -U adelie -d adelie_restored --no-owner < ~/backups/daily/adelie_dev-YYYY-MM-DD.dump
# … або замість робочої (зупинити api і worker, перейменувати бази, запустити знову)
```

## Відкрите

- **Копія поза домом** (пожежа, крадіжка, вихід з ладу диска хоста): кандидати — Cloudflare R2 (акаунт уже є, 10 ГБ
  безкоштовно), Backblaze B2, Google Drive через rclone. Шифрувати перед відправкою (`age`), ключ — поза сервером.
- Скрипт пише в журнал systemd; сповіщення про невдалу копію — разом зі сповіщеннями застосунку.
