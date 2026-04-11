import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Mail, ShieldCheck, Trash2, UserRound, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

type ApprovalRow = {
  id: string;
  user_id: string;
  approved: boolean;
  created_at: string;
  approved_at: string | null;
  full_name: string;
  email: string;
};

export default function AdminApprovals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [emailToApprove, setEmailToApprove] = useState('');

  const { data: approvals = [], isLoading } = useQuery({
    queryKey: ['user-approvals'],
    queryFn: async () => {
      const { data: approvalsData, error: approvalsError } = await supabase
        .from('user_approvals')
        .select('*')
        .order('created_at', { ascending: false });

      if (approvalsError) {
        throw approvalsError;
      }

      if (!approvalsData || approvalsData.length === 0) {
        return [] as ApprovalRow[];
      }

      const userIds = approvalsData.map((approval) => approval.user_id);

      const [profilesResult, emailsResult] = await Promise.all([
        supabase.from('profiles').select('id, full_name').in('id', userIds),
        supabase.rpc('get_approval_emails', { user_ids: userIds }),
      ]);

      if (profilesResult.error) {
        console.warn('Não foi possível buscar nomes dos perfis para a tela de acessos.', profilesResult.error);
      }

      if (emailsResult.error) {
        console.warn('Não foi possível buscar e-mails para a tela de acessos.', emailsResult.error);
      }

      const profileMap = new Map((profilesResult.data || []).map((profile) => [profile.id, profile.full_name]));
      const emailMap = new Map(
        (((emailsResult.data as Array<{ user_id: string; email: string }> | null) || []).map((user) => [
          user.user_id,
          user.email,
        ])),
      );

      return approvalsData.map((approval) => ({
        ...approval,
        full_name: profileMap.get(approval.user_id) || `Usuário ${approval.user_id.slice(0, 8)}`,
        email: emailMap.get(approval.user_id) || approval.user_id,
      }));
    },
  });

  const refreshApprovals = () => {
    queryClient.invalidateQueries({ queryKey: ['user-approvals'] });
    queryClient.invalidateQueries({ queryKey: ['pending-approvals-count'] });
  };

  const approvalMutation = useMutation({
    mutationFn: async ({
      approvalId,
      userId,
      action,
    }: {
      approvalId: string;
      userId: string;
      action: 'approve' | 'reject' | 'revoke';
    }) => {
      if (action === 'reject') {
        const { data, error } = await supabase
          .from('user_approvals')
          .delete()
          .eq('id', approvalId)
          .select('id')
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (!data?.id) {
          throw new Error('O banco não permitiu remover a solicitação. Verifique a policy de delete no Supabase.');
        }

        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const isApproval = action === 'approve';
      const { error } = await supabase
        .from('user_approvals')
        .update({
          approved: isApproval,
          approved_by: user?.id || null,
          approved_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      if (error) {
        throw error;
      }
    },
    onSuccess: (_, { action, approvalId }) => {
      const messages = {
        approve: 'Usuário aprovado com sucesso!',
        reject: 'Solicitação reprovada e removida da fila pendente.',
        revoke: 'Acesso revogado.',
      };

      if (action === 'reject') {
        queryClient.setQueryData<ApprovalRow[]>(['user-approvals'], (current = []) =>
          current.filter((approval) => approval.id !== approvalId),
        );
      }

      toast({ title: messages[action] });
      refreshApprovals();
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao atualizar aprovação',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const grantByEmailMutation = useMutation({
    mutationFn: async (targetEmail: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Sessão expirada. Entre novamente.');
      }

      const { data, error } = await supabase.rpc('grant_access_by_email', {
        target_email: targetEmail,
        approver_user_id: user.id,
      });

      if (error) {
        throw error;
      }

      return data;
    },
    onSuccess: (_, email) => {
      toast({
        title: 'Acesso liberado com sucesso!',
        description: `${email} agora pode entrar no sistema.`,
      });
      setEmailToApprove('');
      refreshApprovals();
    },
    onError: (error: Error) => {
      toast({
        title: 'Não foi possível liberar o acesso',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const pendingApprovals = approvals.filter((approval) => !approval.approved);
  const approvedCount = approvals.filter((approval) => approval.approved).length;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-[linear-gradient(135deg,rgba(18,31,49,0.96),rgba(28,46,73,0.88))] text-white shadow-[0_26px_80px_rgba(15,23,42,0.18)]">
        <div className="grid gap-8 px-6 py-7 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-300">Administração de acessos</p>
            <div className="space-y-3">
              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Controle institucional para aprovar, reprovar e organizar novos acessos.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                Revise solicitações pendentes, libere usuários por e-mail e mantenha o ambiente administrativo do
                escritório com rastreabilidade e clareza.
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-[1.4rem] border border-white/10 bg-white/5 p-4 backdrop-blur sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Solicitações em análise</p>
              <p className="mt-3 text-3xl font-semibold text-white">{pendingApprovals.length}</p>
              <p className="mt-2 text-sm text-slate-300">
                contas aguardando decisão do administrador nesta fila.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Aprovados</p>
              <p className="mt-3 text-3xl font-semibold text-white">{approvedCount}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Total</p>
              <p className="mt-3 text-3xl font-semibold text-white">{approvals.length}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,249,252,0.96))] shadow-[0_12px_28px_rgba(15,23,42,0.06)] dark:bg-[linear-gradient(180deg,rgba(19,28,42,0.96),rgba(15,23,36,0.96))]">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Solicitações pendentes</p>
              <p className="text-2xl font-semibold tracking-tight">{pendingApprovals.length}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,249,252,0.96))] shadow-[0_12px_28px_rgba(15,23,42,0.06)] dark:bg-[linear-gradient(180deg,rgba(19,28,42,0.96),rgba(15,23,36,0.96))]">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <Check className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Usuários aprovados</p>
              <p className="text-2xl font-semibold tracking-tight">{approvedCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,249,252,0.96))] shadow-[0_12px_28px_rgba(15,23,42,0.06)] dark:bg-[linear-gradient(180deg,rgba(19,28,42,0.96),rgba(15,23,36,0.96))]">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Cadastros exibidos</p>
              <p className="text-2xl font-semibold tracking-tight">{approvals.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
        <CardHeader>
          <CardTitle className="text-lg">Liberar acesso por e-mail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="approval-email">E-mail do usuário</Label>
            <Input
              id="approval-email"
              type="email"
              placeholder="pessoa@exemplo.com"
              value={emailToApprove}
              onChange={(event) => setEmailToApprove(event.target.value)}
              className="h-11 rounded-xl border-border/70 bg-background/80"
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Use este campo quando a pessoa já criou a conta e você quer liberar o acesso diretamente.
            </p>
            <Button
              onClick={() => grantByEmailMutation.mutate(emailToApprove.trim().toLowerCase())}
              disabled={!emailToApprove.trim() || grantByEmailMutation.isPending}
              className="rounded-xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(216_48%_34%))]"
            >
              {grantByEmailMutation.isPending ? 'Liberando...' : 'Liberar acesso'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="space-y-1">
            <CardTitle className="text-lg">Fila de aprovação</CardTitle>
            <p className="text-sm text-muted-foreground">
              Aprove os usuários aptos, remova solicitações indevidas e mantenha a fila sob controle.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <div className="overflow-hidden rounded-[1.35rem] border border-border/70">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cadastro</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : approvals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Nenhuma solicitação encontrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  approvals.map((approval) => (
                    <TableRow key={approval.id} className="bg-background/70">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserRound className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{approval.full_name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Mail className="h-4 w-4" />
                          <span>{approval.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={approval.approved ? 'default' : 'outline'}>
                          {approval.approved ? 'Aprovado' : 'Pendente'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(approval.created_at).toLocaleDateString('pt-BR')}
                      </TableCell>
                      <TableCell className="text-right">
                        {!approval.approved ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              className="gap-1 rounded-xl"
                              onClick={() =>
                                approvalMutation.mutate({
                                  approvalId: approval.id,
                                  userId: approval.user_id,
                                  action: 'approve',
                                })
                              }
                              disabled={approvalMutation.isPending}
                            >
                              <Check className="h-3 w-3" />
                              Aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 rounded-xl text-destructive"
                              onClick={() =>
                                approvalMutation.mutate({
                                  approvalId: approval.id,
                                  userId: approval.user_id,
                                  action: 'reject',
                                })
                              }
                              disabled={approvalMutation.isPending}
                            >
                              <Trash2 className="h-3 w-3" />
                              Reprovar
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 rounded-xl"
                            onClick={() =>
                              approvalMutation.mutate({
                                approvalId: approval.id,
                                userId: approval.user_id,
                                action: 'revoke',
                              })
                            }
                            disabled={approvalMutation.isPending}
                          >
                            <X className="h-3 w-3" />
                            Revogar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
