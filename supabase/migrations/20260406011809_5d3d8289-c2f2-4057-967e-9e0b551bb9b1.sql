
-- Update clients RLS to require approval
DROP POLICY "Authenticated users can manage clients" ON public.clients;
CREATE POLICY "Approved users can manage clients"
  ON public.clients FOR ALL TO authenticated
  USING (public.is_approved(auth.uid()))
  WITH CHECK (public.is_approved(auth.uid()));

-- Update billing_records RLS to require approval
DROP POLICY "Authenticated users can manage billing_records" ON public.billing_records;
CREATE POLICY "Approved users can manage billing_records"
  ON public.billing_records FOR ALL TO authenticated
  USING (public.is_approved(auth.uid()))
  WITH CHECK (public.is_approved(auth.uid()));

-- Update email_logs RLS to require approval
DROP POLICY "Authenticated users can manage email_logs" ON public.email_logs;
CREATE POLICY "Approved users can manage email_logs"
  ON public.email_logs FOR ALL TO authenticated
  USING (public.is_approved(auth.uid()))
  WITH CHECK (public.is_approved(auth.uid()));
