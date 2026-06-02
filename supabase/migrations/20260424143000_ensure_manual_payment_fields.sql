ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT,
  ADD COLUMN IF NOT EXISTS payment_notes TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS pix_key TEXT,
  ADD COLUMN IF NOT EXISTS pix_copy_paste TEXT,
  ADD COLUMN IF NOT EXISTS boleto_reference TEXT,
  ADD COLUMN IF NOT EXISTS collection_stage TEXT,
  ADD COLUMN IF NOT EXISTS priority TEXT,
  ADD COLUMN IF NOT EXISTS assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS contact_attempts INTEGER;

UPDATE public.billing_records
SET payment_status = COALESCE(payment_status, 'pending')
WHERE payment_method IS NOT NULL;

UPDATE public.billing_records
SET
  collection_stage = COALESCE(
    collection_stage,
    CASE
      WHEN payment_status = 'paid' THEN 'paga'
      WHEN payment_status = 'cancelled' THEN 'cancelada'
      WHEN status = 'overdue' THEN 'atrasada'
      ELSE 'nova'
    END
  ),
  priority = COALESCE(priority, 'media'),
  contact_attempts = COALESCE(contact_attempts, 0)
WHERE payment_method IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_records_payment_method
  ON public.billing_records USING btree (payment_method);

CREATE INDEX IF NOT EXISTS idx_billing_records_payment_status
  ON public.billing_records USING btree (payment_status);

CREATE INDEX IF NOT EXISTS idx_billing_records_collection_stage
  ON public.billing_records USING btree (collection_stage);
