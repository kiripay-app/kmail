# Trying KMail on a test VM

1. Install mailcow as usual (`./generate_config.sh`, `docker compose pull`).
2. `docker compose build kmail-web kmail-api && docker compose up -d`.
3. Open `https://<your-mail-hostname>/kmail/` for the web shell and `https://<your-mail-hostname>/kmail/api/health` for the API.
4. If mailcow's nginx fails to reload, run `docker compose exec nginx-mailcow nginx -t` and remove `data/conf/nginx/site.kmail.custom` to roll back.

Not yet tested on a live stack: the `resolver 127.0.0.11` line assumes Docker's embedded DNS serves service aliases.
