## Goal

Add 10 ready-to-use, spam-safe email templates to your `email_templates` table so they appear in the Templates list and can be assigned to any campaign.

## Templates included

1. Verify Your Email Address — account verification
2. Reset Your Password — password reset
3. New Login Detected — login alert
4. Your Order Has Been Confirmed — order confirmation
5. Your Order Is On The Way — shipping notification
6. Payment Receipt — invoice/receipt
7. Appointment Confirmed — appointment confirmation
8. Reminder: Upcoming Appointment — appointment reminder
9. Security Update for Your Account — security alert
10. Your Subscription Will Renew Soon — subscription renewal

## Anti-spam design rules applied to every template

- **Plain transactional tone** — no marketing/promo words ("free", "buy now", "limited time", "$$$", "click here").
- **Balanced text-to-HTML ratio** — real sentences, no image-only emails, no large embedded images.
- **No external CSS, no `<style>` blocks, no JS** — only safe inline styles on `<table>`-based layout (works in Gmail/Outlook/Yahoo).
- **Single domain, no link shorteners** — uses `{{action_url}}` / `{{tracking_url}}` placeholders the recipient can trust.
- **Clear sender identity + plain-text fallback feel** — greeting, body, signature, footer with mailing address & unsubscribe placeholder (required by CAN-SPAM/CASL).
- **No suspicious attachments, no hidden text, no all-caps subject, no excessive punctuation.**
- **Personalization placeholders**: `{{name}}`, `{{email}}`, `{{order_id}}`, `{{amount}}`, `{{date}}`, `{{time}}`, `{{location}}`, `{{action_url}}`, `{{company_name}}`, `{{company_address}}`, `{{unsubscribe_url}}` — your worker can substitute these at send time (placeholder substitution is out of scope for this change; templates remain valid HTML if left unreplaced).
- **Each template ~80–150 words** — enough content to avoid "thin email" spam heuristics, short enough to not trigger length flags.

## How they get added

Insert 10 rows into `public.email_templates` (columns: `name`, `subject`, `body`). Nothing else changes — no schema migration, no UI change, no worker change. They will:
- Appear immediately in the **Templates** tab (`TemplateManager.tsx` already lists everything in that table).
- Be selectable when creating a campaign in `CampaignManager.tsx`.
- Be deletable individually from the UI if you don't want one.

## Out of scope (call out if you want them next)

- Placeholder substitution in the worker (currently the worker sends the template body as-is).
- A "Duplicate template" button.
- Categorizing templates (transactional vs. marketing) in the UI.

## Confirm

Proceed with inserting these 10 templates as-is, or would you like to tweak the wording/branding (company name, signature, footer address) before I insert them?
