
-- Create user_approvals table to track approved users
CREATE TABLE public.user_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  approved boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.user_approvals ENABLE ROW LEVEL SECURITY;

-- Security definer function to check if user is approved
CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_approvals
    WHERE user_id = _user_id
      AND approved = true
  )
$$;

-- Security definer function to check if user is the first user (admin)
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_approvals
    WHERE user_id = _user_id
      AND approved = true
      AND user_id = (
        SELECT user_id FROM public.user_approvals
        WHERE approved = true
        ORDER BY approved_at ASC
        LIMIT 1
      )
  )
$$;

-- Auto-create approval record on signup (not approved by default)
CREATE OR REPLACE FUNCTION public.handle_new_user_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  has_any_approved boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.user_approvals WHERE approved = true) INTO has_any_approved;
  
  IF NOT has_any_approved THEN
    -- First user is auto-approved as admin
    INSERT INTO public.user_approvals (user_id, approved, approved_at)
    VALUES (NEW.id, true, now());
  ELSE
    INSERT INTO public.user_approvals (user_id, approved)
    VALUES (NEW.id, false);
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_approval
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_approval();

-- RLS: approved users can view all approvals, admin can update
CREATE POLICY "Approved users can view approvals"
  ON public.user_approvals
  FOR SELECT
  TO authenticated
  USING (public.is_approved(auth.uid()));

CREATE POLICY "Admin can update approvals"
  ON public.user_approvals
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()));
