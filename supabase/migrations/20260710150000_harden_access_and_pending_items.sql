CREATE OR REPLACE FUNCTION public.get_approval_emails(user_ids uuid[])
RETURNS TABLE (user_id uuid, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas administradores podem consultar e-mails de aprovacao.';
  END IF;

  RETURN QUERY
  SELECT au.id AS user_id, au.email::text
  FROM auth.users au
  WHERE au.id = ANY(user_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_access_by_email(target_email text, approver_user_id uuid)
RETURNS TABLE (user_id uuid, email text, approved boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id uuid;
  normalized_email text;
BEGIN
  IF approver_user_id IS DISTINCT FROM auth.uid() OR NOT public.is_admin(approver_user_id) THEN
    RAISE EXCEPTION 'Apenas administradores podem aprovar acessos.';
  END IF;

  normalized_email := lower(trim(target_email));

  IF normalized_email = '' THEN
    RAISE EXCEPTION 'Informe um e-mail valido.';
  END IF;

  SELECT au.id
  INTO target_user_id
  FROM auth.users au
  WHERE lower(au.email::text) = normalized_email
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuario encontrado com esse e-mail.';
  END IF;

  INSERT INTO public.user_approvals (user_id, approved, approved_by, approved_at)
  VALUES (target_user_id, true, approver_user_id, now())
  ON CONFLICT (user_id) DO UPDATE
  SET approved = true,
      approved_by = approver_user_id,
      approved_at = now();

  RETURN QUERY
  SELECT au.id, au.email::text, true
  FROM auth.users au
  WHERE au.id = target_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_approval_emails(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_access_by_email(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_approval_emails(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_access_by_email(text, uuid) TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can manage pending_items" ON public.pending_items;
DROP POLICY IF EXISTS "Approved users can manage pending_items" ON public.pending_items;

CREATE POLICY "Approved users can manage pending_items"
  ON public.pending_items
  FOR ALL
  TO authenticated
  USING (public.is_approved(auth.uid()))
  WITH CHECK (public.is_approved(auth.uid()));
