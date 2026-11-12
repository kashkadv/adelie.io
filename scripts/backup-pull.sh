#!/usr/bin/env bash
# Fetches the newest encrypted dev database backup from the VM to this computer
# (docs/infra/backups.md): a third copy on another device. Run now and then: `pnpm backup:pull`.
# The copy stays encrypted (age); only the owner's key from the password manager opens it.
set -euo pipefail

HOST=${BACKUP_HOST:-adelie@adelie}
DEST=${BACKUP_DEST:-$HOME/Backups/adelie}
KEEP=${KEEP:-8}

mkdir -p "$DEST"
day=$(ssh "$HOST" 'date -d "$(cat ~/backups/last-offsite)" +%F')
target="$DEST/adelie_dev-$day.dump.age"
if [ -f "$target" ]; then
  echo "Already here: $target"
else
  scp -q "$HOST:backups/latest.dump.age" "$target.part"
  head -c 21 "$target.part" | grep -q '^age-encryption.org/v1' || {
    echo "Not an age file — keeping nothing" >&2
    rm -f "$target.part"
    exit 1
  }
  mv "$target.part" "$target"
  echo "Saved $target ($(du -h "$target" | cut -f1))"
fi

# Keep the newest $KEEP (names sort by date).
files=("$DEST"/adelie_dev-*.dump.age)
n=${#files[@]}
if [ "$n" -gt "$KEEP" ]; then rm -- "${files[@]:0:n-KEEP}"; fi
