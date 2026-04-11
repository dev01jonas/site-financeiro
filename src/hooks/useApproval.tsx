import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useApproval() {
  const [approved, setApproved] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const checkApproval = async () => {
      setLoading(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!active) {
        return;
      }

      if (userError || !user) {
        setApproved(false);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      const [approvedResult, adminResult] = await Promise.all([
        supabase.rpc('is_approved', { _user_id: user.id }),
        supabase.rpc('is_admin', { _user_id: user.id }),
      ]);

      if (!active) {
        return;
      }

      if (approvedResult.error || adminResult.error) {
        console.error('Erro ao verificar aprovacao do usuario.', {
          approvedError: approvedResult.error,
          adminError: adminResult.error,
        });
        setApproved(false);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      setApproved(Boolean(approvedResult.data));
      setIsAdmin(Boolean(adminResult.data));
      setLoading(false);
    };

    void checkApproval();

    return () => {
      active = false;
    };
  }, []);

  return { approved, isAdmin, loading };
}
