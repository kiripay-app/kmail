#!/bin/bash
# Step 1. Run ON THE CARBONIO SERVER as the zextras user. Read-only: it changes nothing on Carbonio.
#
# Writes into ~/kmail-export (or the folder you pass as the first argument):
#   accounts.txt   one address per line, with display name:   address,Display Name
#   aliases.csv    alias,destination[;destination]   (account aliases and distribution lists)
#   sizes.txt      mailbox sizes, to plan disk space on the new server
#   dav/<address>/calendar.ics and contacts.vcf
#
# Commands follow Zextras' own migration notes (zmprov / zmmailbox). Run on ONE account first and look at the output.
set -u
OUT="${1:-$HOME/kmail-export}"
mkdir -p "$OUT/dav"
: > "$OUT/accounts.txt"; : > "$OUT/aliases.csv"

echo "Listing accounts..."
# skip admin and Zimbra/Carbonio system mailboxes
for acct in $(zmprov -l gaa | grep -Eiv '^(admin|zextras)@|^(spam|ham|virus-quarantine|galsync)\.[a-z0-9]+@' | sort); do
  name=$(zmprov -l ga "$acct" displayName 2>/dev/null | sed -n 's/^displayName: //p' | tr -d ',')
  echo "$acct,$name" >> "$OUT/accounts.txt"
  # account aliases
  for al in $(zmprov -l ga "$acct" zimbraMailAlias 2>/dev/null | sed -n 's/^zimbraMailAlias: //p'); do
    echo "$al,$acct" >> "$OUT/aliases.csv"
  done
done
echo "  $(wc -l < "$OUT/accounts.txt") accounts"

echo "Distribution lists..."
for dl in $(zmprov -l gadl 2>/dev/null); do
  members=$(zmprov -l gdlm "$dl" 2>/dev/null | grep -E '^[^ ]+@[^ ]+$' | paste -sd';' -)
  [ -n "$members" ] && echo "$dl,$members" >> "$OUT/aliases.csv"
done

echo "Mailbox sizes..."
zmprov -l gqu "$(zmhostname)" > "$OUT/sizes.txt" 2>/dev/null

echo "Calendars and contacts (this is the slow part)..."
while IFS=, read -r acct _; do
  d="$OUT/dav/$acct"; mkdir -p "$d"
  zmmailbox -z -m "$acct" getRestURL "/Calendar?fmt=ics" > "$d/calendar.ics" 2> "$d/calendar.err" || true
  zmmailbox -z -m "$acct" getRestURL "/Contacts?fmt=vcf"  > "$d/contacts.vcf"  2> "$d/contacts.err" || true
  # drop empty results and error files
  for f in calendar.ics contacts.vcf; do [ -s "$d/$f" ] && grep -q '^BEGIN:' "$d/$f" || rm -f "$d/$f"; done
  for f in calendar.err contacts.err; do [ -s "$d/$f" ] && echo "  note ($acct): $(head -c 120 "$d/$f")" || rm -f "$d/$f"; done
  echo "  $acct: $(ls "$d" | tr '\n' ' ')"
done < "$OUT/accounts.txt"

echo
echo "Done. Copy $OUT to the machine you will run the other steps from, e.g.:"
echo "  scp -r $OUT you@your-laptop:~/kmail-export"
echo "Contains mail addresses and calendars: keep it private and delete it after the migration."
