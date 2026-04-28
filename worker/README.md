# MailRotor External Worker

This Node.js worker runs **outside Lovable** because real SMTP requires raw TCP
sockets (ports 25 / 465 / 587), which Cloudflare Workers (Lovable's runtime) do
not support.

It does two things in a loop:

1. **SMTP testing** — picks up rows from `smtp_test_requests` (created when you
   click the "Test" button in the admin UI), runs `nodemailer.verify()`, and
   writes the result back. The status dot in the UI then turns green or red.
2. **Email sending** — when `campaign_state.status = 'running'`, it pulls the
   next pending recipient, rotates SMTP + template, sends via `nodemailer`, and
   updates `send_logs`, `recipients`, and `smtp_accounts.emails_sent`.

The Lovable web app only manages state (add SMTPs, upload templates / lists,
press Start/Pause). This worker does the actual network work.

---

## 1. Get the service-role key

The worker uses the **service role key** (server-only secret) so it can write
to all tables without RLS getting in the way.

In Lovable, open **Cloud → Backend → Settings → API keys** and copy the
**`service_role` secret**. **Never** put this key in your frontend.

## 2. Deploy on a VPS (Hetzner / DigitalOcean / etc.)

Tested on Ubuntu 22.04 / 24.04. Adjust user/paths as needed.

```bash
# 1. SSH into your VPS
ssh root@your-vps-ip

# 2. Install Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 3. Create a service user + folder
useradd -r -m -s /bin/bash mailrotor
mkdir -p /opt/mailrotor-worker
chown mailrotor:mailrotor /opt/mailrotor-worker

# 4. Copy worker files (from your local machine)
#    Run this from your local project root:
#    scp -r worker/* root@your-vps-ip:/opt/mailrotor-worker/

# 5. On the VPS, install deps
cd /opt/mailrotor-worker
sudo -u mailrotor npm install

# 6. Create .env
sudo -u mailrotor cp .env.example .env
sudo -u mailrotor nano .env
# -> paste your SUPABASE_SERVICE_ROLE_KEY, save

# 7. Test it runs
sudo -u mailrotor node worker.js
# You should see:
#   2026-04-28T… MailRotor worker starting…
#   2026-04-28T… Connected to https://…supabase.co
# Press Ctrl+C to stop.
```

## 3. Run as a systemd service (auto-restart, runs on boot)

Create `/etc/systemd/system/mailrotor-worker.service`:

```ini
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
```

Then:

```bash
touch /var/log/mailrotor-worker.log
chown mailrotor:mailrotor /var/log/mailrotor-worker.log

systemctl daemon-reload
systemctl enable --now mailrotor-worker
systemctl status mailrotor-worker
tail -f /var/log/mailrotor-worker.log
```

## 4. Verify everything works

1. Open the admin panel in Lovable.
2. Add an SMTP account.
3. Click **Test** — within ~3 seconds the dot should turn green (or red with
   an error if the credentials are wrong).
4. Add a template, upload some recipients, press **Start Sending**.
5. Watch `tail -f /var/log/mailrotor-worker.log` — you'll see one line per
   send.

## 5. Updating

```bash
# On local machine, after editing worker.js:
scp worker/worker.js root@your-vps-ip:/opt/mailrotor-worker/worker.js

# On VPS:
systemctl restart mailrotor-worker
```

## Troubleshooting

| Symptom                                          | Fix                                                            |
| ------------------------------------------------ | -------------------------------------------------------------- |
| "Test" button times out after 30s                | Worker isn't running. `systemctl status mailrotor-worker`.     |
| All tests fail with `ETIMEDOUT`                  | VPS firewall blocks outbound 587/465. Allow them.              |
| `EAUTH` errors                                   | Wrong username/password — check provider docs.                 |
| Sending starts but stops after one email         | Check the log — likely SMTP got marked inactive on first fail. |
| Mails go to spam                                 | Configure SPF / DKIM / DMARC for the domain in `from`.         |

## Security notes

- Keep `worker/.env` readable only by the `mailrotor` user (`chmod 600`).
- The service-role key bypasses RLS — never commit it to git, never put it in
  any browser-side code.
- Anyone with access to your admin panel password can send through your SMTPs.
  Use a strong password (set in `src/lib/admin-auth.ts`).
