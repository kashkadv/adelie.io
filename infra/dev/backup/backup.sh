#!/usr/bin/env bash
# Nightly backup of the dev database (docs/infra/backups.md). Runs on the VM as `adelie`
# (systemd timer adelie-backup.timer). Every dump is restored into a scratch database and its row
# counts compared with the live one — a backup that cannot be restored does not count.
set -euo pipefail

CONTAINER=${CONTAINER:-adelie-dev-postgres-1}
DB=${DB:-adelie_dev}
DB_USER=${DB_USER:-adelie}
DIR=${BACKUP_DIR:-$HOME/backups}
KEEP_DAILY=${KEEP_DAILY:-7}
KEEP_WEEKLY=${KEEP_WEEKLY:-4}
# Tables whose row counts prove the restore: our own history (cannot be fetched again).
CHECK_TABLES=(social_account social_post post_metric_daily account_metric_value shop_order shop_ledger_entry)

psql() { docker exec -i "$CONTAINER" psql -U "$DB_USER" -v ON_ERROR_STOP=1 -Atq "$@"; }
log() { echo "$(date '+%F %T') $*"; }

mkdir -p "$DIR/daily" "$DIR/weekly"
day=$(date +%F)
file="$DIR/daily/$DB-$day.dump"

log "dump $DB → $file"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB" -Fc -Z 6 > "$file.tmp"
mv "$file.tmp" "$file"

# Restore check: into a scratch database, then compare counts with the live database.
scratch="${DB}_restore_check"
psql -d postgres -c "SET client_min_messages = warning;" -c "DROP DATABASE IF EXISTS $scratch;" -c "CREATE DATABASE $scratch;"
docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$scratch" --no-owner --exit-on-error < "$file"
failed=0
for t in "${CHECK_TABLES[@]}"; do
  live=$(psql -d "$DB" -c "SELECT count(*) FROM $t;")
  restored=$(psql -d "$scratch" -c "SELECT count(*) FROM $t;")
  # The live database may have grown since the dump started; it can never be smaller.
  if [ "$restored" -gt "$live" ] || [ "$restored" -lt $((live * 99 / 100)) ]; then
    log "CHECK FAILED $t: live $live, restored $restored"
    failed=1
  fi
  echo "$t $restored"
done > "$DIR/last-check.txt"
psql -d postgres -c "DROP DATABASE $scratch;"
if [ "$failed" -ne 0 ]; then
  log "restore check failed — keeping the dump, see $DIR/last-check.txt"
  exit 1
fi
log "restore check ok ($(wc -l < "$DIR/last-check.txt") tables, $(du -h "$file" | cut -f1))"

# A weekly copy on Sundays; then keep the newest N of each.
weekly=0
if [ "$(date +%u)" = 7 ]; then cp "$file" "$DIR/weekly/"; weekly=1; fi

# Off-site copy (Cloudflare R2): encrypted with age to a public key — the private key is not on
# this server, so neither the server nor the bucket can read old copies. Enabled by
# ~/adelie/backup/r2.env (RCLONE_CONFIG_R2_* and AGE_RECIPIENT); retention — the bucket's lifecycle.
R2_ENV=${R2_ENV:-$HOME/adelie/backup/r2.env}
BIN=${BIN:-$HOME/adelie/bin}
if [ -f "$R2_ENV" ]; then
  # shellcheck disable=SC1090
  set -a; . "$R2_ENV"; set +a
  enc="$file.age"
  "$BIN/age" -r "$AGE_RECIPIENT" -o "$enc" "$file"
  "$BIN/rclone" -q copyto "$enc" "r2:$R2_BUCKET/daily/$(basename "$enc")"
  if [ "$weekly" = 1 ]; then
    "$BIN/rclone" -q copyto "$enc" "r2:$R2_BUCKET/weekly/$(basename "$enc")"
  fi
  # The newest encrypted copy stays here too: `pnpm backup:pull` fetches it to the owner's Mac.
  mv "$enc" "$DIR/latest.dump.age"
  log "off-site copy → r2:$R2_BUCKET"
  date -Iseconds > "$DIR/last-offsite"
else
  log "off-site copy skipped (no $R2_ENV)"
fi
prune() { # keep the newest $2 dumps in $1 (names sort by date)
  local files=("$1"/*.dump)
  [ -e "${files[0]}" ] || return 0
  local n=${#files[@]}
  if [ "$n" -gt "$2" ]; then rm -- "${files[@]:0:n-$2}"; fi
}
prune "$DIR/daily" "$KEEP_DAILY"
prune "$DIR/weekly" "$KEEP_WEEKLY"
date -Iseconds > "$DIR/last-ok"
log "done"
