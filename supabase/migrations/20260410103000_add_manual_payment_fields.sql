ALTER TABLE public.billing_records
  ADD COLUMN payment_method TEXT,
  ADD COLUMN payment_status TEXT,
  ADD COLUMN payment_notes TEXT,
  ADD COLUMN paid_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN pix_key TEXT,
  ADD COLUMN pix_copy_paste TEXT,
  ADD COLUMN boleto_reference TEXT;

UPDATE public.billing_records
SET payment_status = 'pending'
WHERE payment_status IS NULL
  AND payment_method IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_records_payment_method
  ON public.billing_records USING btree (payment_method);

CREATE INDEX IF NOT EXISTS idx_billing_records_payment_status
  ON public.billing_records USING btree (payment_status);
