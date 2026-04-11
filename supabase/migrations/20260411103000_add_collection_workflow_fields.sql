ALTER TABLE public.billing_records
  ADD COLUMN collection_stage TEXT,
  ADD COLUMN priority TEXT,
  ADD COLUMN assigned_to TEXT,
  ADD COLUMN last_contact_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN contact_attempts INTEGER;

UPDATE public.billing_records
SET
  collection_stage = CASE
    WHEN payment_status = 'paid' THEN 'paga'
    WHEN payment_status = 'cancelled' THEN 'cancelada'
    WHEN status = 'overdue' THEN 'atrasada'
    ELSE 'nova'
  END,
  priority = COALESCE(priority, 'media'),
  contact_attempts = COALESCE(contact_attempts, 0)
WHERE collection_stage IS NULL
   OR priority IS NULL
   OR contact_attempts IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_records_collection_stage
  ON public.billing_records USING btree (collection_stage);
