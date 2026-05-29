// MailRotor external worker (per-campaign)
// Runs OUTSIDE Lovable (on your VPS). Handles:
//   1. smtp_test_requests  -> real nodemailer .verify()
//   2. campaigns where status='running' -> sends recipients one by one,
//      rotating SMTPs and templates as configured per campaign.
//
// Start with:  npm install && npm start

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SEND_POLL_MS = parseInt(process.env.SEND_POLL_INTERVAL_MS ?? '2000', 10);
const TEST_POLL_MS = parseInt(process.env.TEST_POLL_INTERVAL_MS ?? '2000', 10);
const TEST_TIMEOUT_MS = parseInt(process.env.SMTP_TEST_TIMEOUT_MS ?? '15000', 10);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const log = (...a) => console.log(new Date().toISOString(), ...a);

function buildTransport(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.username, pass: smtp.password },
    connectionTimeout: TEST_TIMEOUT_MS,
    greetingTimeout: TEST_TIMEOUT_MS,
    socketTimeout: TEST_TIMEOUT_MS,
  });
}

// ---------- SMTP test loop ----------

async function processTestRequests() {
  const { data: reqs } = await supabase
    .from('smtp_test_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(5);
  if (!reqs || reqs.length === 0) return;

  for (const req of reqs) {
    const { data: smtp } = await supabase
      .from('smtp_accounts').select('*').eq('id', req.smtp_id).single();
    if (!smtp) {
      await supabase.from('smtp_test_requests').update({
        status: 'done', result_ok: false,
        error_message: 'SMTP account not found',
        completed_at: new Date().toISOString(),
      }).eq('id', req.id);
      continue;
    }
    log(`Testing SMTP: ${smtp.name} (${smtp.host}:${smtp.port})`);
    let ok = false, errMsg = null;
    try {
      const transport = buildTransport(smtp);
      await transport.verify();
      transport.close();
      ok = true;
      log(`  ✓ ${smtp.name} active`);
    } catch (e) {
      errMsg = e?.message ?? String(e);
      log(`  ✗ ${smtp.name} failed: ${errMsg}`);
    }
    await supabase.from('smtp_accounts').update({
      is_active: ok, last_tested_at: new Date().toISOString(),
    }).eq('id', smtp.id);
    await supabase.from('smtp_test_requests').update({
      status: 'done', result_ok: ok, error_message: errMsg,
      completed_at: new Date().toISOString(),
    }).eq('id', req.id);
  }
}

// ---------- Per-campaign sending loop ----------

async function processCampaign(campaign) {
  // Pull next pending recipient for THIS campaign
  const { data: nextArr } = await supabase
    .from('recipients').select('*')
    .eq('campaign_id', campaign.id)
    .eq('status', 'pending')
    .order('position', { ascending: true })
    .limit(1);
  const next = nextArr?.[0];

  if (!next) {
    await supabase.from('campaigns').update({
      status: 'completed', updated_at: new Date().toISOString(),
    }).eq('id', campaign.id);
    log(`[${campaign.name}] queue empty — completed`);
    return;
  }

  // Active SMTPs assigned to this campaign
  const { data: smtpRows } = await supabase
    .from('campaign_smtps')
    .select('rotation_order,smtp_accounts(*)')
    .eq('campaign_id', campaign.id)
    .order('rotation_order');
  const smtps = (smtpRows ?? [])
    .map((r) => r.smtp_accounts)
    .filter((s) => s && s.is_active);

  if (smtps.length === 0) {
    await supabase.from('campaigns').update({
      status: 'paused', updated_at: new Date().toISOString(),
    }).eq('id', campaign.id);
    await supabase.from('send_logs').insert({
      campaign_id: campaign.id, campaign_name: campaign.name,
      recipient_email: next.email, status: 'failed',
      error_message: 'No active SMTPs in this campaign — paused',
    });
    log(`[${campaign.name}] paused — no active SMTPs`);
    return;
  }

  // Templates for this campaign
  const { data: tplRows } = await supabase
    .from('campaign_templates')
    .select('rotation_order,email_templates(*)')
    .eq('campaign_id', campaign.id)
    .order('rotation_order');
  const templates = (tplRows ?? []).map((r) => r.email_templates).filter(Boolean);

  if (templates.length === 0) {
    await supabase.from('campaigns').update({
      status: 'paused', updated_at: new Date().toISOString(),
    }).eq('id', campaign.id);
    await supabase.from('send_logs').insert({
      campaign_id: campaign.id, campaign_name: campaign.name,
      recipient_email: next.email, status: 'failed',
      error_message: 'No templates in this campaign — paused',
    });
    log(`[${campaign.name}] paused — no templates`);
    return;
  }

  const smtp =
    campaign.smtp_strategy === 'random'
      ? smtps[Math.floor(Math.random() * smtps.length)]
      : smtps[campaign.smtp_rotation_index % smtps.length];

  const tpl =
    campaign.template_strategy === 'random'
      ? templates[Math.floor(Math.random() * templates.length)]
      : templates[campaign.template_rotation_index % templates.length];

  log(`[${campaign.name}] → ${next.email} via ${smtp.name} / "${tpl.name}"`);

  let sendOk = false, sendErr = null, smtpFault = false;
  try {
    const transport = buildTransport(smtp);
    await transport.sendMail({
      from: smtp.username,
      to: next.email,
      subject: tpl.subject,
      html: tpl.body,
      text: tpl.body.replace(/<[^>]+>/g, ''),
    });
    transport.close();
    sendOk = true;
  } catch (e) {
    sendErr = e?.message ?? String(e);
    smtpFault = /ECONN|ETIMEDOUT|EAUTH|ENOTFOUND|connect|auth/i.test(sendErr);
    log(`  ✗ ${sendErr}`);
  }

  const baseLog = {
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    recipient_email: next.email,
    smtp_id: smtp.id, smtp_name: smtp.name,
    template_id: tpl.id, template_name: tpl.name,
  };

  if (sendOk) {
    await supabase.from('recipients').update({ status: 'sent' }).eq('id', next.id);
    await supabase.from('send_logs').insert({ ...baseLog, status: 'sent' });
    await supabase.from('smtp_accounts').update({
      emails_sent: (smtp.emails_sent ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    }).eq('id', smtp.id);
    await supabase.from('campaigns').update({
      smtp_rotation_index: campaign.smtp_rotation_index + 1,
      template_rotation_index: campaign.template_rotation_index + 1,
      current_position: next.position,
      updated_at: new Date().toISOString(),
    }).eq('id', campaign.id);
    log(`  ✓ sent`);
  } else if (smtpFault) {
    await supabase.from('smtp_accounts').update({
      is_active: false, last_tested_at: new Date().toISOString(),
    }).eq('id', smtp.id);
    await supabase.from('send_logs').insert({
      ...baseLog, status: 'failed',
      error_message: `SMTP failure: ${sendErr} — marked inactive, retrying with next SMTP`,
    });
    await supabase.from('campaigns').update({
      smtp_rotation_index: campaign.smtp_rotation_index + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', campaign.id);
  } else {
    await supabase.from('recipients').update({ status: 'failed' }).eq('id', next.id);
    await supabase.from('send_logs').insert({
      ...baseLog, status: 'failed', error_message: sendErr,
    });
    await supabase.from('campaigns').update({
      smtp_rotation_index: campaign.smtp_rotation_index + 1,
      template_rotation_index: campaign.template_rotation_index + 1,
      current_position: next.position,
      updated_at: new Date().toISOString(),
    }).eq('id', campaign.id);
  }

  const delayMs = Math.max(0, (campaign.delay_seconds ?? 0) * 1000);
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
}

async function processSendQueue() {
  // Only one campaign can be 'running' (DB unique index enforces this).
  const { data: rows } = await supabase
    .from('campaigns').select('*').eq('status', 'running').limit(1);
  const campaign = rows?.[0];
  if (!campaign) return;
  await processCampaign(campaign);
}

async function loopSafe(name, fn, intervalMs) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try { await fn(); }
    catch (e) { log(`[${name}] error:`, e?.message ?? e); }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

log('MailRotor worker starting…');
log(`Connected to ${SUPABASE_URL}`);

loopSafe('test', processTestRequests, TEST_POLL_MS);
loopSafe('send', processSendQueue, SEND_POLL_MS);
