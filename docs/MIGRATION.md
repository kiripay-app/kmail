# Moving from Carbonio to KMail

This guide moves mail, calendars, contacts, aliases and distribution lists from a Carbonio server (here `hq.pub.com.ki`, change the names to suit) to a KMail server. The scripts are in `migration/`.

**Honest status:** nothing here has been run against a real Carbonio or a real KMail server yet. The commands come from Zextras' own migration notes and imapsync's documentation, and the scripts were tested only against stand-ins. That is why the plan is built around a **pilot with one or two people first**. Do not skip it.

## The idea in one paragraph

The old server is never touched. imapsync copies mail across and can be run again and again, copying only what is new, so the bulk of the data moves days before anyone notices. On cutover day you point the mail records (MX) at the new server, run the copy once more to catch the last few messages, and keep running it for a few days to sweep up stragglers. If anything goes wrong, the old server is still there with all its mail, and you point the records back.

## What moves, and what does not

| Moves | How |
| --- | --- |
| Mail, all folders, read/unread and other flags, original dates | imapsync (step 3) |
| Calendar (the default calendar) | Export as `.ics`, import with KMail's import (step 4) |
| Contacts (the default address book) | Export as `.vcf`, import with KMail's import (step 4) |
| Account aliases and distribution lists | Become aliases (step 2) |

| Does **not** move | What to do |
| --- | --- |
| Passwords | Not available to copy. Each person gets a one-time password from step 2 and should change it at first sign-in. |
| Extra calendars and shared calendars | Only the default calendar is exported. Ask people which others matter and export those by hand from the Carbonio web page. |
| Mail filters, vacation replies, signatures | Ask people to note them down. Recreate by hand. |
| Shared folders, delegation, "send on behalf" | Recreate on the new server. |
| Phones | Everyone re-adds the account on their phone once (ActiveSync via SOGo). Plan a short how-to for staff. |

## Before you start

- **New server ready and tested.** Mailcow plus KMail running, HTTPS working, a test mailbox that can send and receive. Do this on the VM test first (`docs/TESTING.md`).
- **Port 25.** Hetzner blocks outgoing port 25 on some accounts until you ask them to open it. Check before cutover, not during it.
- **Reverse DNS (PTR).** The new server's IP must point back to its mail hostname. Set it in Hetzner's panel.
- **SPF, DKIM, DMARC.** Create the DKIM key in the admin panel (DKIM page) and publish the TXT record. Update SPF to include the new server's IP. These matter more than anything else for your mail landing in inboxes.
- **DNS access.** If the DNS move to Cloudflare is done by then, the changes take effect fast and you can flip things back fast. If not, check the TTL and lower it to 300 seconds (5 minutes) at least 48 hours before cutover.
- **Disk space.** Look at `sizes.txt` from step 1. The new server needs room for all of it, plus the same again for headroom.
- **A global admin login on Carbonio.** imapsync uses it to read every mailbox without knowing each person's password (Zextras documents this approach). On Carbonio this is `zextras@yourdomain` or `admin@yourdomain`.
- **Tell staff** what is happening, when, and that they will get a new temporary password.

## Steps

### 1. Export from Carbonio (read-only)

Copy `migration/01-export-from-carbonio.sh` to the Carbonio server and run it as the `zextras` user:

```
bash 01-export-from-carbonio.sh
```

It writes `~/kmail-export/` with the account list, aliases and lists, mailbox sizes, and each person's calendar and contacts. Read the output. Anything it could not export is noted per account. Copy the folder to the machine you will run the other steps from. It holds people's calendars and addresses, so keep it private and delete it when you are done.

Check `accounts.txt`: remove any account you do not want to migrate (old staff, test accounts). Format is `address,Display Name`.

### 2. Create the mailboxes and aliases on the new server

Add your domains first (admin panel, Domains page). Then, on the new server, from the KMail folder:

```
docker compose exec -T kmail-admin node dist/cli.js import-mailboxes --dry < accounts.txt
docker compose exec -T kmail-admin node dist/cli.js import-mailboxes --quota 2048 < accounts.txt > passwords.csv
docker compose exec -T kmail-admin node dist/cli.js import-aliases < aliases.csv
```

The first command only shows what it would do. The second creates the mailboxes and writes `passwords.csv` (`address,password`, one-time random passwords). **Guard that file**: it is every new password. Accounts that already exist are left alone and are not in the file. Everything is recorded in the audit log.

If the admin panel is not set up yet, create the mailboxes by hand in mailcow's own UI and write the passwords into `passwords.csv` yourself in the same format.

### 3. Pilot: one or two people (try the whole path)

Pick yourself and one patient colleague.

```
export SRC_HOST=hq.pub.com.ki SRC_ADMIN=zextras@pub.com.ki SRC_ADMIN_PASS='...' DST_HOST=mail.pub.com.ki
bash migration/03-sync-mail.sh --only you@pub.com.ki            # dry run: shows what would be copied
bash migration/03-sync-mail.sh --go --only you@pub.com.ki       # the real copy
node migration/04-import-calendar-contacts.mjs --host https://mail.pub.com.ki --export ~/kmail-export --passwords passwords.csv --only you@pub.com.ki
```

Then check, as that person, in KMail and on a phone:

- Folder list and counts match the old mailbox (Sent, Drafts, Trash, Junk landed in the right folders; `--automap` handles this).
- A few old messages open, with attachments, and dates are the original dates.
- Calendar events and contacts are there. Look for events that should repeat.
- **Calendar import and invitations.** If the calendar server emails attendees when an event is saved, importing old meetings could send invitations to everyone on them. Test with a person who has meetings with other people, using a calendar where you can watch the mail log. If anyone gets an email, re-run for the rest with `--strip-attendees` (events then arrive as plain events without organiser and attendee lines).
- Sending and receiving mail works from the new account.
- Add the account to a phone and see mail and calendar arrive.

If something is off, the imapsync log for that person is in `sync-logs/`. Fix, and run the pilot again. Re-running is safe.

### 4. First full copy (days before cutover)

```
bash migration/03-sync-mail.sh                 # dry run for everyone: look for FAILED
bash migration/03-sync-mail.sh --go            # real copy
node migration/04-import-calendar-contacts.mjs --host https://mail.pub.com.ki --export ~/kmail-export --passwords passwords.csv
```

This can take hours. Run it inside `tmux` or `screen` so a dropped connection does not stop it. Re-run the failed accounts until they are clean. Calendars and contacts only need doing once, again at cutover if people have been editing.

### 5. Cutover

1. Lower the DNS TTL on the MX and mail host records at least 48 hours earlier (300 seconds).
2. Pick a quiet time. Tell staff.
3. Run `03-sync-mail.sh --go` once more.
4. Change the **MX record** (and the mail hostname's A record, if people connect by name) to the new server.
5. Send a test mail from outside (a personal account) to a migrated address and confirm it arrives on the new server.
6. Hand out the temporary passwords. Staff sign in at `https://mail.pub.com.ki/kmail/`, set a new password, and re-add their phones.
7. For the next few days run `03-sync-mail.sh --go` once or twice a day. Some senders keep using the old address for a while, so mail can still land on Carbonio. Each run copies it across.
8. Re-run step 4's calendar and contacts import once more at the end of the week for any changes people made on the old server.

### 6. Rollback (if the new server misbehaves)

- Point the MX (and host record) back at Carbonio. Because the TTL is short, this takes minutes.
- Mail that arrived on the new server in the meantime is only there. Copy it back by running imapsync the other way round: swap host1 and host2 in a copy of `03-sync-mail.sh` (the new server's passwords are the ones in `passwords.csv`). Do this before you point people back, or they will think mail has vanished.
- Do not decommission Carbonio until the new server has run cleanly for at least a few weeks. Take a snapshot of the Carbonio server before you finally switch it off.

## Troubleshooting

- **Authentication fails on the old server.** Check the admin address and password by logging in to the Carbonio admin console. If imapsync still fails, make sure the admin address is in the same domain form Carbonio expects, and that IMAP over SSL (port 993) is reachable from where you run the script. Zextras' notes also show a Carbonio-side admin (`zextras@carbonio.local`) used when Carbonio is the target.
- **Certificate errors on the old server.** If it uses a self-signed certificate, set `IMAPSYNC_EXTRA="--sslargs1 SSL_verify_mode=0"` and re-run.
- **A folder is "missing" or appears twice.** Look at the dry run. Carbonio has some internal folders (for example chats) that are not mail. Exclude them with `IMAPSYNC_EXTRA="--exclude '^Chats$'"`. Multiple options can be given.
- **Over quota on the new server.** Raise the quota in the admin panel (Mailboxes) or use `--quota` in step 2, and run again.
- **Very large messages fail.** Raise the limit in mailcow and Carbonio's attachment limits for the migration window (Zextras recommends this).
- **Duplicates.** imapsync skips messages already copied, so re-running does not double up. Duplicates only appear if people also copied mail into the new mailbox by hand.
- **Contacts did not export.** The script asks Carbonio for vCard format. If that is refused on your version, export contacts as CSV (the format Zextras' own notes use) or from the web client, and import into KMail's Contacts page.

## Later improvement (not done)

Carbonio stores password hashes that Dovecot may be able to accept directly, which would let people keep their passwords. This has not been checked here and needs care, so the guide uses temporary passwords.

Sources: [How to use imapsync to migrate Zimbra to Carbonio CE (Zextras)](https://community.zextras.com/how-to-use-imapsync-to-migrate-zimbra-to-carbonio-carbonio-ce), [imapsync](https://github.com/imapsync/imapsync).
