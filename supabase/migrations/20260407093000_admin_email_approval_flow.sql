CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_approvals ua
    JOIN auth.users au ON au.id = ua.user_id
    WHERE ua.user_id = _user_id
      AND ua.approved = true
      AND (
        lower(au.email) = 'advogadosmodaelli06@gmail.com'
        OR ua.user_id = (
          SELECT inner_ua.user_id
          FROM public.user_approvals inner_ua
          WHERE inner_ua.approved = true
          ORDER BY inner_ua.approved_at ASC NULLS LAST
          LIMIT 1
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  has_any_approved boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.user_approvals
    WHERE approved = true
  ) INTO has_any_approved;

  IF lower(coalesce(NEW.email, '')) = 'advogadosmodaelli06@gmail.com' THEN
    INSERT INTO public.user_approvals (user_id, approved, approved_at)
    VALUES (NEW.id, true, now())
    ON CONFLICT (user_id) DO UPDATE
    SET approved = true,
        approved_at = COALESCE(public.user_approvals.approved_at, EXCLUDED.approved_at);
  ELSIF NOT has_any_approved THEN
    INSERT INTO public.user_approvals (user_id, approved, approved_at)
    VALUES (NEW.id, true, now())
    ON CONFLICT (user_id) DO UPDATE
    SET approved = true,
        approved_at = COALESCE(public.user_approvals.approved_at, EXCLUDED.approved_at);
  ELSE
    INSERT INTO public.user_approvals (user_id, approved)
    VALUES (NEW.id, false)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_approval_emails(user_ids uuid[])
RETURNS TABLE (user_id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.id AS user_id, au.email::text
  FROM auth.users au
  WHERE au.id = ANY(user_ids)
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
