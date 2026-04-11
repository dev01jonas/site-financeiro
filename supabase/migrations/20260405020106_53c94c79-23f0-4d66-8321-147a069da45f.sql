
-- Drop old permissive policies
DROP POLICY IF EXISTS "Allow all access to clients" ON public.clients;
DROP POLICY IF EXISTS "Allow all access to billing_records" ON public.billing_records;
DROP POLICY IF EXISTS "Allow all access to email_logs" ON public.email_logs;

-- clients: authenticated users only
CREATE POLICY "Authenticated users can manage clients"
  ON public.clients FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- billing_records: authenticated users only
CREATE POLICY "Authenticated users can manage billing_records"
  ON public.billing_records FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- email_logs: authenticated users only
CREATE POLICY "Authenticated users can manage email_logs"
  ON public.email_logs FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
