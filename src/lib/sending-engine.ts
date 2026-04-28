// Sending engine has been moved out of the browser.
//
// Real SMTP requires raw TCP sockets (ports 25/465/587), which Cloudflare
// Workers (Lovable's runtime) does not support. Instead, a small Node.js
// worker runs OUTSIDE Lovable (see /worker folder) and:
//   1. Polls campaign_state and recipients for pending sends
//   2. Sends real emails via nodemailer
//   3. Polls smtp_test_requests for "Test SMTP" button clicks
//   4. Writes results back to send_logs / smtp_accounts / smtp_test_requests
//
// The browser UI only manages state (start/pause/resume/config). The worker
// observes campaign_state.status === 'running' and processes the queue.

export function isEngineRunning() {
  return false;
}

export async function startEngine() {
  // No-op. The external Node worker handles sending.
}

export function requestStop() {
  // No-op. Pausing is done by setting campaign_state.status = 'paused' in DB,
  // which the worker observes between sends.
}
