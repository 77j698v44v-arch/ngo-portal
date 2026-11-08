# Deploying the NGO portal on the shared VPS

Same channels as the college portal: Supabase Postgres, Node under PM2 on the VPS behind nginx (HTTPS on the shared
public port 10061), frontend on Netlify.

Placeholders in angle brackets (`<VPS_IP>`, `<SSH_PORT>`) are yours to fill in. Real IPs and secrets are deliberately
not written in this file, so it's safe to commit to GitHub.

**Never reuse from the college portal:** the port (use 3001), the PM2 name (`ngo-portal`), the nginx `server_name`, or its database.

---

## A. On your PC

### 1. New Supabase project (not the college one)
Project Settings → Database → Connection string. Copy the **Session pooler** string and put your database password in it.
Use the pooler string, not the "Direct connection": direct connections are IPv6-only and most VPSs can't reach them.
If login ever fails with "tenant not found", the free project has paused: open Supabase and click **Resume**.

### 2. New GitHub repo
```bash
cd ngo-portal
git init
git add .
git commit -m "NGO portal"
git branch -M main
git remote add origin <new-repo-url>
git push -u origin main
```
`.gitignore` already keeps `.env` and `node_modules` out.

---

## B. On the VPS

### 1. Connect
```bash
ssh -p <SSH_PORT> administrator@<VPS_IP>
sudo -i
```

### 2. Set your subdomain once, and check the port is free
```bash
export API_DOMAIN=api2.yourdomain.org      # <- the real subdomain you picked
ss -tulpn | grep 3001                      # must print nothing
```

### 3. Clone and install
```bash
cd ~
git clone <new-repo-url> ngo-portal
cd ngo-portal/backend
npm install --omit=dev
```

### 4. Create `.env` (heredoc, no nano needed)
Replace the DATABASE_URL line with your Supabase session-pooler string. The quotes around `EOF` matter: they stop the shell
from touching special characters in your password.
```bash
cat > .env << 'EOF'
PORT=3001
NODE_ENV=production
DATABASE_URL=PASTE_YOUR_SUPABASE_SESSION_POOLER_URL_HERE
DATABASE_SSL=true
CORS_ORIGIN=
EOF
echo "JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" >> .env
chmod 600 .env
```
`CORS_ORIGIN` stays blank for now. You'll fill it in at step C3 once Netlify gives you the site address.

### 5. Create the tables and your first chief account
Use a strong password you haven't used anywhere else.
```bash
ADMIN_USERNAME='your-login-id' ADMIN_PASSWORD='choose-a-strong-password' ADMIN_ROLE=project_coordinator npm run seed
```
You should see `Created "your-login-id".`

### 6. Start it under PM2
```bash
cd ~/ngo-portal
pm2 start deploy/ecosystem.config.js
pm2 save
curl -s localhost:3001/api/health          # prints {"ok":true}
```

### 7. DNS, certificate, nginx
In **Netlify DNS** add an **A record**: name = the first part of your subdomain (e.g. `api2`), value = `<VPS_IP>`.
Then:
```bash
certbot certonly -a dns-multi --dns-multi-credentials=/etc/letsencrypt/dns-multi.ini -d $API_DOMAIN

sed "s/__API_DOMAIN__/$API_DOMAIN/g; s/__PORT__/3001/g" deploy/nginx-ngo-portal.conf.template > /etc/nginx/sites-available/ngo-portal
ln -s /etc/nginx/sites-available/ngo-portal /etc/nginx/sites-enabled/
nginx -t
```
Only continue if `nginx -t` says the test is successful. Then use **reload** (not restart) so the college portal isn't interrupted:
```bash
systemctl reload nginx
```

### 8. Test the API
```bash
curl -s https://$API_DOMAIN:10061/api/health
```
Should print `{"ok":true}`. (It also works in a browser. The API address itself even serves the portal login page,
so you can already log in there before doing Netlify.)

---

## C. Frontend on Netlify

### 1. Point the frontend at the API
Edit `frontend/config.js`: remove the `//` before `window.API_BASE` and use your real address (must be `https`):
```js
window.API_BASE = 'https://api2.yourdomain.org:10061/api';
```
```bash
git add -A && git commit -m "Set API address" && git push
```

### 2. New Netlify site
Add new site → Import from GitHub → pick the repo. Leave the build command empty. The publish folder is `frontend`
(already set in `netlify.toml`). Deploy.

### 3. Lock the API to your Netlify site
Back on the VPS, put the Netlify address (and your custom domain if you add one, comma separated) into `.env`:
```bash
cd ~/ngo-portal/backend
sed -i 's|^CORS_ORIGIN=.*|CORS_ORIGIN=https://your-site.netlify.app|' .env
pm2 restart ngo-portal
```
Open the Netlify address and log in.

---

## Updating later
```bash
cd ~/ngo-portal && git pull
cd backend && npm install --omit=dev && npm run migrate
pm2 restart ngo-portal
```
`npm run migrate` applies any new database changes and is safe to run repeatedly.

## Things that can bite you
- **Blank screen or "failed to fetch" on Netlify:** `config.js` still has the `//`, the address isn't `https`, or `:10061` is missing.
- **CORS error in the browser console:** `CORS_ORIGIN` doesn't exactly match the Netlify address (no trailing slash), or you didn't `pm2 restart`.
- **502 from nginx:** the app isn't running. Check `pm2 logs ngo-portal` (a wrong `DATABASE_URL` is the usual cause).
- **Everyone locked out after a few tries:** nginx is missing the `X-Forwarded-For` line, so all users look like one visitor. The template already includes it.
- **The DNS plugin can't make the certificate:** your Netlify token only covers domains whose DNS is on your Netlify account. For a domain hosted elsewhere, tell me and we'll do the manual DNS method.
- Keep a private backup of the server `.env` on your PC. Never commit it.
