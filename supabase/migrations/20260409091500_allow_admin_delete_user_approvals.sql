DROP POLICY IF EXISTS "Admin can delete approvals" ON public.user_approvals;

CREATE POLICY "Admin can delete approvals"
  ON public.user_approvals
  FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));
