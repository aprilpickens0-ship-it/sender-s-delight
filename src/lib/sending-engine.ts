import { supabase } from "@/integrations/supabase/client";

// Mocked SMTP send — simulates latency and a small failure rate.
// Replace this function with a real backend send call later.
async function mockSmtpSend(_smtp: any, _email: string, _subject: string, _body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
  // ~5% transient failure, ~2% smtp-down failure
  const r = Math.random();
  if (r < 0.02) return { ok: false, error: "SMTP_CONN_REFUSED" };
  if (r < 0.07) return { ok: false, error: "Recipient rejected (550)" };
  return { ok: true };
}

// Mocked SMTP test — random pass/fail biased to pass
export async function mockSmtpTest(_smtp: { host: string; port: number; username: string; password: string }) {
  await new Promise((r) => setTimeout(r, 800 + Math.random() * 800));
  // Fail if obvious bad input
  if (!_smtp.host || !_smtp.username) return { ok: false, error: "Missing host/username" };
  // 85% success
  return Math.random() < 0.85
    ? { ok: true as const }
    : { ok: false as const, error: "Authentication failed" };
}

let running = false;
let stopRequested = false;

export function isEngineRunning() {
  return running;
}

export async function startEngine() {
  if (running) return;
  running = true;
  stopRequested = false;
  try {
    await loop();
  } finally {
    running = false;
  }
}

export function requestStop() {
  stopRequested = true;
}

async function loop() {
  while (!stopRequested) {
    // Read state
    const { data: state } = await supabase.from("campaign_state").select("*").eq("id", 1).single();
    if (!state) break;
    if (state.status !== "running") break;

    // Get next pending recipient
    const { data: nextRecipients } = await supabase
      .from("recipients")
      .select("*")
      .eq("status", "pending")
      .order("position", { ascending: true })
      .limit(1);

    const next = nextRecipients?.[0];
    if (!next) {
      // Done!
      await supabase.from("campaign_state").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", 1);
      break;
    }

    // Get active SMTPs ordered
    const { data: smtps } = await supabase
      .from("smtp_accounts")
      .select("*")
      .eq("is_active", true)
      .order("rotation_order", { ascending: true });

    if (!smtps || smtps.length === 0) {
      // No active SMTPs — pause campaign
      await supabase
        .from("campaign_state")
        .update({ status: "paused", updated_at: new Date().toISOString() })
        .eq("id", 1);
      await supabase.from("send_logs").insert({
        recipient_email: next.email,
        status: "failed",
        error_message: "No active SMTP accounts available — campaign paused",
      });
      break;
    }

    // Get templates
    const { data: templates } = await supabase
      .from("email_templates")
      .select("*")
      .order("created_at", { ascending: true });

    if (!templates || templates.length === 0) {
      await supabase
        .from("campaign_state")
        .update({ status: "paused", updated_at: new Date().toISOString() })
        .eq("id", 1);
      await supabase.from("send_logs").insert({
        recipient_email: next.email,
        status: "failed",
        error_message: "No templates available — campaign paused",
      });
      break;
    }

    // Pick SMTP using rotation index, skipping inactive
    const smtpIdx = state.smtp_rotation_index % smtps.length;
    const smtp = smtps[smtpIdx];

    // Pick template
    const tpl =
      state.template_strategy === "random"
        ? templates[Math.floor(Math.random() * templates.length)]
        : templates[state.template_rotation_index % templates.length];

    // Send (mocked)
    const result = await mockSmtpSend(smtp, next.email, tpl.subject, tpl.body);

    if (result.ok) {
      // Mark sent + log
      await supabase.from("recipients").update({ status: "sent" }).eq("id", next.id);
      await supabase.from("send_logs").insert({
        recipient_email: next.email,
        smtp_id: smtp.id,
        smtp_name: smtp.name,
        template_id: tpl.id,
        template_name: tpl.name,
        status: "sent",
      });
      await supabase
        .from("smtp_accounts")
        .update({
          emails_sent: (smtp.emails_sent ?? 0) + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", smtp.id);

      // Advance rotation indices
      await supabase
        .from("campaign_state")
        .update({
          smtp_rotation_index: state.smtp_rotation_index + 1,
          template_rotation_index: state.template_rotation_index + 1,
          current_position: next.position,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);
    } else {
      // Detect SMTP-level fault → mark inactive and retry same recipient on next loop
      const smtpFault = /CONN|TIMEOUT|AUTH/i.test(result.error);
      if (smtpFault) {
        await supabase
          .from("smtp_accounts")
          .update({ is_active: false, last_tested_at: new Date().toISOString() })
          .eq("id", smtp.id);
        await supabase.from("send_logs").insert({
          recipient_email: next.email,
          smtp_id: smtp.id,
          smtp_name: smtp.name,
          template_id: tpl.id,
          template_name: tpl.name,
          status: "failed",
          error_message: `SMTP failure: ${result.error} — marked inactive, retrying with next SMTP`,
        });
        // Don't mark recipient failed; loop will pick next SMTP
        await supabase
          .from("campaign_state")
          .update({
            smtp_rotation_index: state.smtp_rotation_index + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", 1);
      } else {
        // Recipient-level failure
        await supabase.from("recipients").update({ status: "failed" }).eq("id", next.id);
        await supabase.from("send_logs").insert({
          recipient_email: next.email,
          smtp_id: smtp.id,
          smtp_name: smtp.name,
          template_id: tpl.id,
          template_name: tpl.name,
          status: "failed",
          error_message: result.error,
        });
        await supabase
          .from("campaign_state")
          .update({
            smtp_rotation_index: state.smtp_rotation_index + 1,
            template_rotation_index: state.template_rotation_index + 1,
            current_position: next.position,
            updated_at: new Date().toISOString(),
          })
          .eq("id", 1);
      }
    }

    // Re-check stop / pause
    if (stopRequested) break;
    const { data: latest } = await supabase.from("campaign_state").select("status,delay_seconds").eq("id", 1).single();
    if (!latest || latest.status !== "running") break;

    // Delay
    const delayMs = Math.max(0, (latest.delay_seconds ?? 0) * 1000);
    const slept = Date.now();
    while (Date.now() - slept < delayMs) {
      if (stopRequested) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}
