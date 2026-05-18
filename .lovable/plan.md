## Fresh DigitalOcean Droplet Setup — MailRotor Worker

A clean, copy-paste guide to get the worker running from scratch. Each block is meant to be pasted as-is into the droplet's SSH session.

---

### 1. Create the droplet (in DigitalOcean dashboard)

- Image: **Ubuntu 24.04 LTS**
- Plan: Basic, **Regular / 1 GB RAM / 1 CPU** ($6/mo is enough)
- Region: closest to you
- Authentication: **SSH key** (preferred) or password
- Hostname: `mailrotor-worker`
- Click **Create Droplet**, copy the public IP

---

### 2. SSH in

```bash
ssh root@YOUR_DROPLET_IP
```

---

### 3. Install Node 22 + basics

(Node 22 avoids the WebSocket polyfill issue you hit with Node 20.)

```bash
apt-get update && apt-get install -y curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node -v
```

You should see `v22.x.x`.

---

### 4. Create the service user and folder

```bash
useradd -r -m -s /bin/bash mailrotor
mkdir -p /opt/mailrotor-worker
chown mailrotor:mailrotor /opt/mailrotor-worker
```

---

### 5. Upload the worker files

**Run this from your LOCAL machine** (your laptop), from the project root:

```bash
scp -r worker/* root@YOUR_DROPLET_IP:/opt/mailrotor-worker/
```

Back on the droplet, fix ownership:

```bash
chown -R mailrotor:mailrotor /opt/mailrotor-worker
```

---

### 6. Install dependencies

```bash
sudo -u mailrotor bash -lc 'cd /opt/mailrotor-worker && npm install'
```

(No `cd` on its own line — always inside `bash -lc '...'` so it runs as the `mailrotor` user in the right folder.)

---

### 7. Create the `.env`

```bash
sudo -u mailrotor cp /opt/mailrotor-worker/.env.example /opt/mailrotor-worker/.env
sudo -u mailrotor nano /opt/mailrotor-worker/.env
```

Paste these values, then save (Ctrl+O, Enter, Ctrl+X):

```
SUPABASE_URL=https://zmbnejgdswsojqwvvrab.supabase.co
SUPABASE_SERVICE_ROLE_KEY=PASTE_YOUR_SERVICE_ROLE_KEY_HERE
SEND_POLL_INTERVAL_MS=2000
TEST_POLL_INTERVAL_MS=2000
SMTP_TEST_TIMEOUT_MS=15000
```

Lock it down:

```bash
chmod 600 /opt/mailrotor-worker/.env
```

> Get the service role key from Lovable → Cloud → Backend → Settings → API keys → `service_role` secret.

---

### 8. Smoke test (run once in the foreground)

```bash
sudo -u mailrotor bash -lc 'cd /opt/mailrotor-worker && node worker.js'
```

You should see:

```
2026-... MailRotor worker starting…
2026-... Connected to https://zmbnejgdswsojqwvvrab.supabase.co
```

Press **Ctrl+C** to stop.

If you see any error, stop here and paste the output — do not continue.

---

### 9. Install as a systemd service

```bash
cat > /etc/systemd/system/mailrotor-worker.service << 'EOF'
[Unit]
Description=MailRotor SMTP Worker
After=network.target

[Service]
Type=simple
User=mailrotor
WorkingDirectory=/opt/mailrotor-worker
EnvironmentFile=/opt/mailrotor-worker/.env
ExecStart=/usr/bin/node /opt/mailrotor-worker/worker.js
Restart=always
RestartSec=5
StandardOutput=append:/var/log/mailrotor-worker.log
StandardError=append:/var/log/mailrotor-worker.log

[Install]
WantedBy=multi-user.target
EOF

touch /var/log/mailrotor-worker.log
chown mailrotor:mailrotor /var/log/mailrotor-worker.log

systemctl daemon-reload
systemctl enable --now mailrotor-worker
sleep 3
systemctl status mailrotor-worker --no-pager
tail -n 40 /var/log/mailrotor-worker.log
```

Expected: `active (running)` and the same `MailRotor worker starting…` / `Connected to …` lines.

---

### 10. Verify end-to-end

1. Open the admin panel in Lovable.
2. Add (or re-test) an SMTP account → click **Test**. Dot should turn green within ~3s.
3. Watch live: `tail -f /var/log/mailrotor-worker.log`

---

### Handy commands later

```bash
systemctl restart mailrotor-worker         # restart after editing worker.js
systemctl stop mailrotor-worker            # stop
journalctl -u mailrotor-worker -n 100      # alternate log view
tail -f /var/log/mailrotor-worker.log      # follow logs
```

To update worker code: re-run the `scp` from step 5, then `systemctl restart mailrotor-worker`.

---

### Before I proceed

A couple of things to confirm so I tailor the guide if needed:

1. Do you already have your **SUPABASE_SERVICE_ROLE_KEY** handy, or do you need a reminder where to find it?
2. Are you SSH-ing from **macOS/Linux** (so `scp` works directly) or **Windows** (then we'd use WinSCP or PowerShell `scp`)?
