CREATE TABLE public.smtp_test_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  smtp_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result_ok BOOLEAN,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.smtp_test_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon all smtp_test_requests"
ON public.smtp_test_requests
FOR ALL
USING (true)
WITH CHECK (true);

CREATE INDEX idx_smtp_test_requests_status ON public.smtp_test_requests(status, created_at);