
-- Campaigns: replace global singleton with per-campaign records
CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'idle',
  delay_seconds int NOT NULL DEFAULT 5,
  template_strategy text NOT NULL DEFAULT 'sequential',
  smtp_strategy text NOT NULL DEFAULT 'sequential',
  smtp_rotation_index int NOT NULL DEFAULT 0,
  template_rotation_index int NOT NULL DEFAULT 0,
  current_position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO anon, authenticated;
GRANT ALL ON public.campaigns TO service_role;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all campaigns" ON public.campaigns FOR ALL USING (true) WITH CHECK (true);

-- Enforce only one running campaign at a time
CREATE UNIQUE INDEX one_running_campaign ON public.campaigns ((status)) WHERE status = 'running';

-- Junction: campaign <-> smtp accounts
CREATE TABLE public.campaign_smtps (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  smtp_id uuid NOT NULL REFERENCES public.smtp_accounts(id) ON DELETE CASCADE,
  rotation_order int NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, smtp_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_smtps TO anon, authenticated;
GRANT ALL ON public.campaign_smtps TO service_role;
ALTER TABLE public.campaign_smtps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all campaign_smtps" ON public.campaign_smtps FOR ALL USING (true) WITH CHECK (true);

-- Junction: campaign <-> templates
CREATE TABLE public.campaign_templates (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.email_templates(id) ON DELETE CASCADE,
  rotation_order int NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, template_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_templates TO anon, authenticated;
GRANT ALL ON public.campaign_templates TO service_role;
ALTER TABLE public.campaign_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all campaign_templates" ON public.campaign_templates FOR ALL USING (true) WITH CHECK (true);

-- Recipients belong to a campaign
ALTER TABLE public.recipients
  ADD COLUMN campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE;
CREATE INDEX recipients_campaign_status_idx ON public.recipients (campaign_id, status, position);

-- Logs reference a campaign
ALTER TABLE public.send_logs
  ADD COLUMN campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  ADD COLUMN campaign_name text;

-- Drop the now-unused singleton
DROP TABLE public.campaign_state;
