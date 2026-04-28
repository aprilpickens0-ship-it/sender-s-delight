// MailRotor external worker
// Runs OUTSIDE Lovable (on your VPS) because Cloudflare Workers can't open
// raw TCP sockets for SMTP. This single Node process handles two queues:
//   1. smtp_test_requests  -> real nodemailer .verify()
//   2. recipients (status=pending) when campaign_state.status='running'
//      -> real nodemailer .sendMail()
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

// ---------- helpers ----------

function buildTransport(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465, // SSL on 465, STARTTLS otherwise
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
      .from('smtp_accounts')
      .select('*')
      .eq('id', req.smtp_id)
      .single();

    if (!smtp) {
      await supabase.from('smtp_test_requests').update({
        status: 'done',
        result_ok: false,
        error_message: 'SMTP account not found',
        completed_at: new Date().toISOString(),
      }).eq('id', req.id);
      continue;
    }

    log(`Testing SMTP: ${smtp.name} (${smtp.host}:${smtp.port})`);
    let ok = false;
    let errMsg = null;
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
      is_active: ok,
      last_tested_at: new Date().toISOString(),
    }).eq('id', smtp.id);

    await supabase.from('smtp_test_requests').update({
      status: 'done',
      result_ok: ok,
      error_message: errMsg,
      completed_at: new Date().toISOString(),
    }).eq('id', req.id);
  }
}

// ---------- Sending loop ----------

async function processSendQueue() {
  const { data: state } = await supabase
    .from('campaign_state')
    .select('*')
    .eq('id', 1)
    .single();

  if (!state || state.status !== 'running') return;

  // Pull next pending recipient
  const { data: nextArr } = await supabase
    .from('recipients')
    .select('*')
    .eq('status', 'pending')
    .order('position', { ascending: true })
    .limit(1);

  const next = nextArr?.[0];
  if (!next) {
    await supabase.from('campaign_state').update({
      status: 'completed',
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    log('Queue empty — campaign completed');
    return;
  }

  // Active SMTPs
  const { data: smtps } = await supabase
    .from('smtp_accounts')
    .select('*')
    .eq('is_active', true)
    .order('rotation_order', { ascending: true });

  if (!smtps || smtps.length === 0) {
    await supabase.from('campaign_state').update({
      status: 'paused',
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    await supabase.from('send_logs').insert({
      recipient_email: next.email,
      status: 'failed',
      error_message: 'No active SMTPs — campaign paused',
    });
    log('No active SMTPs — paused');
    return;
  }

  // Templates
  const { data: templates } = await supabase
    .from('email_templates')
    .select('*')
    .order('created_at', { ascending: true });

  if (!templates || templates.length === 0) {
    await supabase.from('campaign_state').update({
      status: 'paused',
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    await supabase.from('send_logs').insert({
      recipient_email: next.email,
      status: 'failed',
      error_message: 'No templates — campaign paused',
    });
    log('No templates — paused');
    return;
  }

  const smtp = smtps[state.smtp_rotation_index % smtps.length];
  const tpl =
    state.template_strategy === 'random'
      ? templates[Math.floor(Math.random() * templates.length)]
      : templates[state.template_rotation_index % templates.length];

  log(`Sending to ${next.email} via ${smtp.name} using template "${tpl.name}"`);

  let sendOk = false;
  let sendErr = null;
  let smtpFault = false;
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
    // Treat connection / auth errors as SMTP-level faults (deactivate the account)
    smtpFault = /ECONN|ETIMEDOUT|EAUTH|ENOTFOUND|connect|auth/i.test(sendErr);
    log(`  ✗ ${sendErr}`);
  }

  if (sendOk) {
    await supabase.from('recipients').update({ status: 'sent' }).eq('id', next.id);
    await supabase.from('send_logs').insert({
      recipient_email: next.email,
      smtp_id: smtp.id,
      smtp_name: smtp.name,
      template_id: tpl.id,
      template_name: tpl.name,
      status: 'sent',
    });
    await supabase.from('smtp_accounts').update({
      emails_sent: (smtp.emails_sent ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    }).eq('id', smtp.id);
    await supabase.from('campaign_state').update({
      smtp_rotation_index: state.smtp_rotation_index + 1,
      template_rotation_index: state.template_rotation_index + 1,
      current_position: next.position,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    log(`  ✓ sent`);
  } else if (smtpFault) {
    await supabase.from('smtp_accounts').update({
      is_active: false,
      last_tested_at: new Date().toISOString(),
    }).eq('id', smtp.id);
    await supabase.from('send_logs').insert({
      recipient_email: next.email,
      smtp_id: smtp.id,
      smtp_name: smtp.name,
      template_id: tpl.id,
      template_name: tpl.name,
      status: 'failed',
      error_message: `SMTP failure: ${sendErr} — marked inactive, retrying with next SMTP`,
    });
    await supabase.from('campaign_state').update({
      smtp_rotation_index: state.smtp_rotation_index + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
  } else {
    await supabase.from('recipients').update({ status: 'failed' }).eq('id', next.id);
    await supabase.from('send_logs').insert({
      recipient_email: next.email,
      smtp_id: smtp.id,
      smtp_name: smtp.name,
      template_id: tpl.id,
      template_name: tpl.name,
      status: 'failed',
      error_message: sendErr,
    });
    await supabase.from('campaign_state').update({
      smtp_rotation_index: state.smtp_rotation_index + 1,
      template_rotation_index: state.template_rotation_index + 1,
      current_position: next.position,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
  }

  // Honour configured delay
  const delayMs = Math.max(0, (state.delay_seconds ?? 0) * 1000);
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
}

// ---------- main loops ----------

async function loopSafe(name, fn, intervalMs) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fn();
    } catch (e) {
      log(`[${name}] error:`, e?.message ?? e);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

log('MailRotor worker starting…');
log(`Connected to ${SUPABASE_URL}`);

loopSafe('test', processTestRequests, TEST_POLL_MS);
loopSafe('send', processSendQueue, SEND_POLL_MS);
