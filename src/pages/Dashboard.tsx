import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CheckCircle2,
  Clock,
  FileText,
  MailCheck,
  Radar,
  ReceiptText,
  ShieldAlert,
  Upload,
  Users,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useApproval } from '@/hooks/useApproval';

type BillingRow = {
  id: string;
  client_name: string;
  client_email?: string | null;
  due_date: string;
  amount: number;
  status: string;
  payment_method?: string | null;
  payment_status?: string | null;
  collection_stage?: string | null;
  priority?: string | null;
  assigned_to?: string | null;
  contact_attempts?: number | null;
  paid_at?: string | null;
  created_at?: string | null;
};

type EmailLogRow = {
  id: string;
  client_name: string;
  client_email: string;
  amount: number;
  sent_at: string;
};

const STAGE_LABELS: Record<string, string> = {
  nova: 'Nova',
  em_cobranca: 'Em cobrança',
  aguardando_pagamento: 'Aguardando pagamento',
  paga: 'Paga',
  atrasada: 'Atrasada',
  cancelada: 'Cancelada',
};

function parseDueDate(value: string | null) {
  if (!value) return null;

  if (value.includes('-')) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }

  const [day, month, year] = value.split('/').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function formatCurrency(value: number) {
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

function formatCompactCurrency(value: number) {
  if (Math.abs(value) >= 1000000) {
    return `R$ ${(value / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  }

  if (Math.abs(value) >= 1000) {
    return `R$ ${(value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  }

  return formatCurrency(value);
}

function daysUntil(value: string | null) {
  const dueDate = parseDueDate(value);
  if (!dueDate) return 9999;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getMonthLabel(value: string) {
  const dueDate = parseDueDate(value);
  if (!dueDate) return 'Sem data';
  return dueDate.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
}

function getStage(record: BillingRow) {
  if (record.payment_status === 'paid' || record.collection_stage === 'paga') return 'paga';
  if (record.payment_status === 'cancelled' || record.collection_stage === 'cancelada') return 'cancelada';
  if (record.collection_stage) return record.collection_stage;
  if (daysUntil(record.due_date) < 0 && record.status !== 'sent') return 'atrasada';
  if (record.status === 'sent') return 'aguardando_pagamento';
  return 'nova';
}

function getPriorityScore(record: BillingRow) {
  const overdueDays = Math.max(Math.abs(Math.min(daysUntil(record.due_date), 0)), 0);
  const stage = getStage(record);
  const priority = record.priority === 'alta' ? 35 : record.priority === 'media' ? 18 : 8;
  const stageScore = stage === 'atrasada' ? 42 : stage === 'em_cobranca' ? 26 : stage === 'aguardando_pagamento' ? 18 : 8;
  return priority + stageScore + Math.min(overdueDays * 3, 45) + Number(record.amount) / 10000;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAdmin } = useApproval();

  const { data: clients = 0 } = useQuery({
    queryKey: ['clients-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('clients').select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count || 0;
    },
  });

  const { data: pendingApprovals = 0 } = useQuery({
    queryKey: ['pending-approvals-count'],
    enabled: isAdmin,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('user_approvals')
        .select('*', { count: 'exact', head: true })
        .eq('approved', false)
        .is('approved_by', null);

      if (error) throw error;
      return count || 0;
    },
  });

  const { data: billingRecords = [] } = useQuery({
    queryKey: ['billing-dashboard-records'],
    queryFn: async () => {
      const { data, error } = await supabase.from('billing_records').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as BillingRow[];
    },
  });

  const { data: recentEmails = [] } = useQuery({
    queryKey: ['recent-emails'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_logs')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      return (data || []) as EmailLogRow[];
    },
  });

  const { data: emailCount = 0 } = useQuery({
    queryKey: ['email-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('email_logs').select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count || 0;
    },
  });

  const dashboard = useMemo(() => {
    const total = billingRecords.length;
    const totalAmount = billingRecords.reduce((sum, record) => sum + Number(record.amount), 0);
    const paidRecords = billingRecords.filter((record) => record.payment_status === 'paid' || getStage(record) === 'paga');
    const paidAmount = paidRecords.reduce((sum, record) => sum + Number(record.amount), 0);
    const overdueRecords = billingRecords.filter((record) => getStage(record) === 'atrasada');
    const overdueAmount = overdueRecords.reduce((sum, record) => sum + Number(record.amount), 0);
    const nextSeven = billingRecords.filter((record) => {
      const diff = daysUntil(record.due_date);
      return diff >= 0 && diff <= 7 && !['paga', 'cancelada'].includes(getStage(record));
    });
    const pendingWithoutEmail = billingRecords.filter((record) => !record.client_email && getStage(record) !== 'paga');
    const sendRate = total ? Math.round((billingRecords.filter((record) => record.status === 'sent').length / total) * 100) : 0;
    const paidRate = totalAmount ? Math.round((paidAmount / totalAmount) * 100) : 0;
    const overdueRate = totalAmount ? Math.round((overdueAmount / totalAmount) * 100) : 0;

    const healthScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(82 + paidRate * 0.16 + sendRate * 0.08 - overdueRate * 0.75 - pendingWithoutEmail.length * 2),
      ),
    );

    const monthMap = new Map<string, { month: string; total: number; paid: number; overdue: number }>();
    billingRecords.forEach((record) => {
      const month = getMonthLabel(record.due_date);
      const current = monthMap.get(month) || { month, total: 0, paid: 0, overdue: 0 };
      current.total += Number(record.amount);
      if (getStage(record) === 'paga') current.paid += Number(record.amount);
      if (getStage(record) === 'atrasada') current.overdue += Number(record.amount);
      monthMap.set(month, current);
    });

    const priorityQueue = [...billingRecords]
      .filter((record) => !['paga', 'cancelada'].includes(getStage(record)))
      .sort((a, b) => getPriorityScore(b) - getPriorityScore(a))
      .slice(0, 5);

    return {
      total,
      totalAmount,
      paidAmount,
      overdueAmount,
      overdueRecords,
      nextSeven,
      pendingWithoutEmail,
      sendRate,
      paidRate,
      healthScore,
      monthlyData: Array.from(monthMap.values()).slice(-6),
      priorityQueue,
    };
  }, [billingRecords]);

  const executiveCards = [
    {
      title: 'Carteira total',
      value: formatCurrency(dashboard.totalAmount),
      subtitle: `${dashboard.total} cobrança(s) no financeiro`,
      icon: BriefcaseBusiness,
      tone: 'from-slate-50 to-white dark:from-slate-900/80 dark:to-slate-950/80',
    },
    {
      title: 'Recebido confirmado',
      value: formatCurrency(dashboard.paidAmount),
      subtitle: `${dashboard.paidRate}% do valor controlado`,
      icon: CheckCircle2,
      tone: 'from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-950/80',
    },
    {
      title: 'Risco em atraso',
      value: formatCurrency(dashboard.overdueAmount),
      subtitle: `${dashboard.overdueRecords.length} cobrança(s) exigem atenção`,
      icon: AlertTriangle,
      tone: 'from-rose-50 to-white dark:from-rose-950/30 dark:to-slate-950/80',
    },
    {
      title: 'Próximos 7 dias',
      value: String(dashboard.nextSeven.length),
      subtitle: 'Vencimentos entrando na janela de ação',
      icon: Clock,
      tone: 'from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-950/80',
    },
  ];

  const actionCards = [
    {
      title: 'Importar cobranças',
      description: 'Ler PDF ou Excel e vincular clientes para envio.',
      icon: Upload,
      onClick: () => navigate('/cobrancas'),
    },
    {
      title: 'Criar cobrança manual',
      description: 'Gerar PIX ou boleto simples com acompanhamento.',
      icon: ReceiptText,
      onClick: () => navigate('/pagamentos'),
    },
    {
      title: 'Analisar pendencias',
      description: 'Consolidar pendencias por pessoa e exportar DOC.',
      icon: ShieldAlert,
      onClick: () => navigate('/analise-pendencias'),
    },
    {
      title: 'Revisar histórico',
      description: 'Conferir envios, valores comunicados e registros.',
      icon: MailCheck,
      onClick: () => navigate('/historico'),
    },
  ];

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-[#142238] text-white shadow-[0_30px_90px_rgba(15,23,42,0.22)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(218,184,107,0.26),transparent_28%),radial-gradient(circle_at_88%_12%,rgba(83,142,204,0.26),transparent_30%),linear-gradient(135deg,rgba(20,34,56,0.98),rgba(30,49,78,0.92))]" />
        <div className="absolute -bottom-24 right-12 h-56 w-56 rounded-full border border-white/10 bg-white/5 blur-sm" />

        <div className="relative grid gap-8 px-6 py-7 lg:grid-cols-[1.25fr_0.75fr] lg:px-8 lg:py-8">
          <div className="space-y-6">
            <Badge className="w-fit rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-100 hover:bg-white/10">
              Modaelli Advogados
            </Badge>

            <div className="space-y-3">
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
                Visão financeira limpa, direta e pronta para decisão.
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-slate-300">
                O dashboard agora foca nas cobranças, clientes, envios e prioridades que já estão em uso no escritório.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => navigate('/cobrancas')} className="rounded-xl bg-white px-4 text-slate-950 hover:bg-slate-100">
                <Upload className="mr-2 h-4 w-4" />
                Nova cobrança
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/analise-pendencias')}
                className="rounded-xl border-white/20 bg-white/5 px-4 text-white hover:bg-white/10 hover:text-white"
              >
                <ShieldAlert className="mr-2 h-4 w-4" />
                Analisar pendencias
              </Button>
            </div>
          </div>

          <div className="rounded-[1.65rem] border border-white/10 bg-white/8 p-5 backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-300">Índice da carteira</p>
                <p className="mt-4 text-5xl font-semibold tracking-tight">{dashboard.healthScore}</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3">
                <Radar className="h-6 w-6 text-amber-200" />
              </div>
            </div>
            <Progress value={dashboard.healthScore} className="mt-5 h-2 bg-white/10" />
            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-300">Envio</p>
                <p className="mt-2 text-xl font-semibold">{dashboard.sendRate}%</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-300">Recebido</p>
                <p className="mt-2 text-xl font-semibold">{dashboard.paidRate}%</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-300">Atraso</p>
                <p className="mt-2 text-xl font-semibold">{dashboard.overdueRecords.length}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {isAdmin && pendingApprovals > 0 ? (
        <Card className="border-amber-300/70 bg-[linear-gradient(135deg,rgba(255,251,235,0.9),rgba(255,247,214,0.95))] shadow-sm dark:bg-[linear-gradient(135deg,rgba(77,59,23,0.38),rgba(59,44,19,0.3))]">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-700" />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-100">Existem solicitações pendentes de aprovação.</p>
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  Você tem {pendingApprovals} conta(s) aguardando liberação de acesso.
                </p>
              </div>
            </div>
            <Button onClick={() => navigate('/acessos')} className="rounded-xl sm:self-start">
              Revisar acessos
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Resumo executivo</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Os números principais para acompanhar a rotina financeira atual.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {executiveCards.map((card) => (
            <Card
              key={card.title}
              className={`overflow-hidden border-border/70 bg-gradient-to-br ${card.tone} shadow-[0_16px_40px_rgba(15,23,42,0.07)]`}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">{card.title}</p>
                    <p className="text-2xl font-semibold tracking-tight">{card.value}</p>
                  </div>
                  <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                    <card.icon className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-4 text-xs leading-5 text-muted-foreground">{card.subtitle}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.12fr_0.88fr]">
        <Card className="border-border/70 shadow-[0_16px_42px_rgba(15,23,42,0.06)]">
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5 text-accent" />
                  Resumo operacional
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Um recorte simples do que precisa de atenção no financeiro atual.
                </p>
              </div>
              <Button variant="outline" className="rounded-xl" onClick={() => navigate('/cobrancas')}>
                Abrir cobranças
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 sm:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-sm text-muted-foreground">Cobranças no painel</p>
              <p className="mt-2 text-3xl font-semibold">{dashboard.total}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-sm text-muted-foreground">Próximos 7 dias</p>
              <p className="mt-2 text-3xl font-semibold">{dashboard.nextSeven.length}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-sm text-muted-foreground">Sem e-mail</p>
              <p className="mt-2 text-3xl font-semibold">{dashboard.pendingWithoutEmail.length}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-sm text-muted-foreground">E-mails enviados</p>
              <p className="mt-2 text-3xl font-semibold">{emailCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-[0_16px_42px_rgba(15,23,42,0.06)]">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <BarChart3 className="h-5 w-5 text-accent" />
              Evolução financeira
            </CardTitle>
            <p className="text-sm text-muted-foreground">Total, recebido e atrasado por vencimento.</p>
          </CardHeader>
          <CardContent className="p-5">
            {dashboard.monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={dashboard.monthlyData}>
                  <defs>
                    <linearGradient id="totalGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="hsl(214 53% 42%)" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="hsl(214 53% 42%)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="overdueGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="hsl(0 68% 54%)" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="hsl(0 68% 54%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => formatCompactCurrency(Number(value))} />
                  <Tooltip formatter={(value: number, name: string) => [formatCurrency(Number(value)), name]} />
                  <Area dataKey="total" name="Total" stroke="hsl(214 53% 42%)" fill="url(#totalGradient)" strokeWidth={3} />
                  <Area dataKey="paid" name="Recebido" stroke="hsl(151 48% 36%)" fill="transparent" strokeWidth={3} />
                  <Area dataKey="overdue" name="Atrasado" stroke="hsl(0 68% 54%)" fill="url(#overdueGradient)" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">Nenhum dado financeiro disponível ainda.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.82fr]">
        <Card className="border-border/70 shadow-[0_16px_42px_rgba(15,23,42,0.06)]">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 text-accent" />
              Fila de prioridade
            </CardTitle>
            <p className="text-sm text-muted-foreground">Cobranças que mais merecem ação agora.</p>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {dashboard.priorityQueue.length > 0 ? (
              dashboard.priorityQueue.map((record) => {
                const stage = getStage(record);
                const diff = daysUntil(record.due_date);
                return (
                  <div key={record.id} className="rounded-2xl border border-border/70 bg-background/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{record.client_name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {record.client_email || 'Sem e-mail vinculado'} · venc. {record.due_date}
                        </p>
                      </div>
                      <Badge variant={stage === 'atrasada' ? 'destructive' : 'secondary'}>{STAGE_LABELS[stage] || stage}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{formatCurrency(Number(record.amount))}</Badge>
                      <Badge variant="outline">{diff < 0 ? `${Math.abs(diff)} dia(s) em atraso` : `vence em ${diff} dia(s)`}</Badge>
                      <Badge variant="outline">{record.assigned_to ? `Resp. ${record.assigned_to}` : 'Sem responsável'}</Badge>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma cobrança pendente na fila.</p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="border-border/70 shadow-[0_16px_42px_rgba(15,23,42,0.06)]">
            <CardHeader className="border-b border-border/60 pb-4">
              <CardTitle className="text-lg">Atalhos rápidos</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 p-5">
              {actionCards.map((card) => (
                <button
                  key={card.title}
                  type="button"
                  onClick={card.onClick}
                  className="group rounded-2xl border border-border/70 bg-background/80 p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)]"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                        <card.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-medium">{card.title}</p>
                        <p className="text-xs leading-5 text-muted-foreground">{card.description}</p>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-[0_16px_42px_rgba(15,23,42,0.06)]">
            <CardHeader className="border-b border-border/60 pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-accent" />
                Últimos e-mails
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5">
              {recentEmails.length > 0 ? (
                recentEmails.map((log) => (
                  <div key={log.id} className="rounded-2xl border border-border/70 bg-background/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{log.client_name}</p>
                        <p className="text-xs text-muted-foreground">{log.client_email}</p>
                      </div>
                      <p className="text-sm font-medium">{formatCurrency(Number(log.amount))}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">Nenhum e-mail enviado ainda.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-border/70 shadow-[0_16px_42px_rgba(15,23,42,0.06)]">
        <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
          <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
            <p className="text-sm text-muted-foreground">Clientes cadastrados</p>
            <p className="mt-2 text-2xl font-semibold">{clients}</p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
            <p className="text-sm text-muted-foreground">E-mails enviados</p>
            <p className="mt-2 text-2xl font-semibold">{emailCount}</p>
          </div>
          <Button variant="outline" onClick={() => navigate('/clientes')} className="h-full min-h-20 justify-between rounded-2xl">
            Gerenciar clientes
            <ArrowRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
