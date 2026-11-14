#!/bin/bash
# Step 3. Copies mail from Carbonio to the new server with imapsync (run in Docker, nothing to install).
# Safe to repeat: each run only copies what is new, so you can run it days before the cutover and again after.
#
#   ./03-sync-mail.sh                         dry run for everyone (changes nothing)
#   ./03-sync-mail.sh --only bob@pub.com.ki   dry run for one person
#   ./03-sync-mail.sh --go                    real copy for everyone
#   ./03-sync-mail.sh --go --only bob@pub.com.ki
#
# Settings (environment variables):
#   SRC_HOST        old server, e.g. hq.pub.com.ki
#   SRC_ADMIN       a Carbonio global admin, e.g. admin@pub.com.ki or zextras@pub.com.ki
#   SRC_ADMIN_PASS  its password (or put it in a file and set SRC_ADMIN_PASSFILE)
#   DST_HOST        new server, e.g. mail.pub.com.ki
#   PASSWORDS       the passwords.csv written by step 2 (address,password), default ./passwords.csv
set -u
GO=0; ONLY=""
while [ $# -gt 0 ]; do case "$1" in --go) GO=1;; --only) ONLY="$2"; shift;; *) echo "unknown option $1"; exit 2;; esac; shift; done

: "${SRC_HOST:?set SRC_HOST}"; : "${SRC_ADMIN:?set SRC_ADMIN}"; : "${DST_HOST:?set DST_HOST}"
PASSWORDS="${PASSWORDS:-./passwords.csv}"; [ -f "$PASSWORDS" ] || { echo "No $PASSWORDS (step 2 creates it)"; exit 2; }
command -v docker >/dev/null || { echo "docker is needed"; exit 2; }

WORK=$(mktemp -d); chmod 700 "$WORK"; trap 'rm -rf "$WORK"' EXIT     # password files live here only while running
LOGS="$PWD/sync-logs"; mkdir -p "$LOGS"
if [ -n "${SRC_ADMIN_PASSFILE:-}" ]; then cp "$SRC_ADMIN_PASSFILE" "$WORK/src_admin"; else printf '%s' "${SRC_ADMIN_PASS:?set SRC_ADMIN_PASS or SRC_ADMIN_PASSFILE}" > "$WORK/src_admin"; fi
chmod 600 "$WORK/src_admin"

DRY="--dry"; [ "$GO" = 1 ] && DRY=""
echo "Mode: $([ "$GO" = 1 ] && echo 'REAL COPY' || echo 'dry run (nothing is changed)')"
ok=0; bad=0; failed=()
while IFS=, read -r addr pw; do
  [ -z "$addr" ] && continue
  [ -n "$ONLY" ] && [ "$ONLY" != "$addr" ] && continue
  printf '%s' "$pw" > "$WORK/dst_$addr"; chmod 600 "$WORK/dst_$addr"
  echo "--- $addr"
  docker run --rm -v "$WORK":/pw:ro -v "$LOGS":/logs gilleslamiral/imapsync imapsync \
    --host1 "$SRC_HOST" --ssl1 --user1 "$addr" --authuser1 "$SRC_ADMIN" --passfile1 /pw/src_admin \
    --host2 "$DST_HOST" --ssl2 --user2 "$addr" --passfile2 "/pw/dst_$addr" \
    --automap --nofoldersizes --logfile "/logs/$addr.$(date +%Y%m%d-%H%M).log" $DRY ${IMAPSYNC_EXTRA:-} >/dev/null 2>&1
  rc=$?
  if [ $rc -eq 0 ]; then echo "    OK"; ok=$((ok+1)); else echo "    FAILED (exit $rc), see sync-logs/"; bad=$((bad+1)); failed+=("$addr"); fi
  rm -f "$WORK/dst_$addr"
done < "$PASSWORDS"

echo; echo "Finished: $ok ok, $bad failed. Logs are in $LOGS"
[ $bad -gt 0 ] && printf 'Failed: %s\n' "${failed[@]}"
exit $bad
