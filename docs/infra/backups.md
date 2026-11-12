# Резервні копії бази dev

Пріоритет за [ADR-0025](../decisions/0025-own-tool-first.md): частина даних існує лише в нашій базі — історія старша за
90 днів, щоденні метрики Instagram (з різниці знімків), журнал змін товарів, події Flipper. Платформи її вже не віддадуть.

## Що робиться

**1. Щоночі на VM** (`infra/dev/backup/backup.sh`, таймер `adelie-backup.timer` — встановлено 2026-11-12; 02:30 UTC, до синхронізації о 04:00):
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

**3. Копія поза домом — Cloudflare R2** (працює з 2026-11-12, перша копія — `daily/adelie_dev-2026-11-12.dump.age`): той самий скрипт шифрує дамп `age` на **публічний** ключ
(приватний — лише у власника, не на сервері) і відправляє `rclone` у бакет `adelie-backups`: `daily/…dump.age`, у
неділю ще `weekly/…`. Термін зберігання в R2 — правило життєвого циклу бакета. Вмикається файлом
`~/adelie/backup/r2.env` (права 600); програми — `~/adelie/bin/age` (v1.2.1) і `~/adelie/bin/rclone` (v1.69.1), без
`sudo`. Час останньої копії поза домом — `~/backups/last-offsite`.

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

## Налаштування R2 (одноразово)

1. Cloudflare → R2 → **Create bucket** `adelie-backups`. Settings → **Object lifecycle rules**: префікс `daily/` —
   видаляти через 30 днів; `weekly/` — через 180 днів.
2. R2 → **Manage R2 API Tokens** → Create: дозвіл **Object Read & Write**, лише бакет `adelie-backups`. Дає Access Key
   ID, Secret Access Key; Account ID — у правій колонці R2.
3. На Mac: `brew install age && age-keygen -o ~/adelie-backup.agekey` — **приватний ключ зберегти в менеджері паролів**
   (без нього копії не відновити), файл видалити; публічний ключ (`age1…`) — не секрет.
4. Записати налаштування на VM (секрети не потрапляють ні в чат, ні в історію терміналу):

```bash
ssh -t adelie@adelie 'read -rp "R2 account id: " A; read -rsp "R2 access key id: " K; echo; read -rsp "R2 secret access key: " S; echo; read -rp "age public key (age1…): " P; umask 077; printf "RCLONE_CONFIG_R2_TYPE=s3\nRCLONE_CONFIG_R2_PROVIDER=Cloudflare\nRCLONE_CONFIG_R2_ACCESS_KEY_ID=%s\nRCLONE_CONFIG_R2_SECRET_ACCESS_KEY=%s\nRCLONE_CONFIG_R2_ENDPOINT=https://%s.r2.cloudflarestorage.com\nRCLONE_CONFIG_R2_NO_CHECK_BUCKET=true\nR2_BUCKET=adelie-backups\nAGE_RECIPIENT=%s\n" "$K" "$S" "$A" "$P" > ~/adelie/backup/r2.env; echo saved'
```

**Розшифрування ключем власника перевірено** (2026-11-12, копія з R2 на Mac → дамп 7,3 МБ). Файл, завантажений
з кабінету Cloudflare, має `_` замість `/` у назві; розшифрування: `age -d -i <файл з ключем> -o x.dump <файл>.age`.

**Відновлення з R2:** `rclone copy r2:adelie-backups/daily/<файл>.age .` → `age -d -i adelie-backup.agekey -o x.dump
<файл>.age` → `pg_restore` (див. вище).

## Відкрите

- Копія на хост Proxmox (п. 2) — потребує доступу root на хості, чекає дозволу.
- Скрипт пише в журнал systemd; сповіщення про невдалу копію — разом зі сповіщеннями застосунку.
