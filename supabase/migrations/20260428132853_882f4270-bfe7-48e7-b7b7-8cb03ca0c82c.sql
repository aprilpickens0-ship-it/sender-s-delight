
-- SMTP accounts
CREATE TABLE public.smtp_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 587,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  last_tested_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  emails_sent INTEGER NOT NULL DEFAULT 0,
  rotation_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email templates
CREATE TABLE public.email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recipients (the queue)
CREATE TABLE public.recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_recipients_status_position ON public.recipients(status, position);

-- Send logs
CREATE TABLE public.send_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email TEXT NOT NULL,
  smtp_id UUID,
  smtp_name TEXT,
  template_id UUID,
  template_name TEXT,
  status TEXT NOT NULL, -- sent | failed
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_send_logs_created_at ON public.send_logs(created_at DESC);

-- Single-row campaign state
CREATE TABLE public.campaign_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'idle', -- idle | running | paused | completed
  delay_seconds INTEGER NOT NULL DEFAULT 5,
  current_position INTEGER NOT NULL DEFAULT 0,
  smtp_rotation_index INTEGER NOT NULL DEFAULT 0,
  template_rotation_index INTEGER NOT NULL DEFAULT 0,
  template_strategy TEXT NOT NULL DEFAULT 'sequential', -- sequential | random
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campaign_state_singleton CHECK (id = 1)
);
INSERT INTO public.campaign_state (id) VALUES (1);

-- Enable RLS and allow anon full access (admin gated via UI password)
ALTER TABLE public.smtp_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.send_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon all smtp" ON public.smtp_accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon all templates" ON public.email_templates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon all recipients" ON public.recipients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon all logs" ON public.send_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon all state" ON public.campaign_state FOR ALL USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.campaign_state;
ALTER PUBLICATION supabase_realtime ADD TABLE public.recipients;
ALTER PUBLICATION supabase_realtime ADD TABLE public.send_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.smtp_accounts;
