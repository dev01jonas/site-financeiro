import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Clock,
  DollarSign,
  Send,
  ShieldAlert,
  TrendingUp,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useApproval } from '@/hooks/useApproval';

const COLORS = [
  'hsl(214 53% 42%)',
  'hsl(151 48% 36%)',
  'hsl(0 68% 54%)',
  'hsl(40 91% 52%)',
];

function parseDueDate(value: string) {
  const [day, month, year] = value.split('/');
  return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0);
}

function formatCurrency(value: number) {
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAdmin } = useApproval();

  const { data: clients = 0 } = useQuery({
    queryKey: ['clients-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('clients').select('*', { count: 'exact', head: true });
      if (error) {
        throw error;
      }
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

      if (error) {
        throw error;
      }

      return count || 0;
    },
  });

  const { data: billingStats } = useQuery({
    queryKey: ['billing-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.from('billing_records').select('*');
      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        return {
          total: 0,
          overdue: 0,
          sent: 0,
          pending: 0,
          totalAmount: 0,
          overdueAmount: 0,
          monthlyData: [] as Array<{ month: string; total: number }>,
          statusData: [] as Array<{ name: string; value: number }>,
        };
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const overdue = data.filter((record) => parseDueDate(record.due_date) < today && record.status !== 'sent');
      const sent = data.filter((record) => record.status === 'sent');
      const pending = data.length - sent.length - overdue.length;

      const monthMap = new Map<string, number>();
      data.forEach((record) => {
        const [, month, year] = record.due_date.split('/');
        const key = `${month}/${year}`;
        monthMap.set(key, (monthMap.get(key) || 0) + Number(record.amount));
      });

      const monthlyData = Array.from(monthMap.entries())
        .slice(-6)
        .map(([month, total]) => ({ month, total }));

      const statusData = [
        { name: 'Enviadas', value: sent.length },
        { name: 'Vencidas', value: overdue.length },
        { name: 'Pendentes', value: pending },
      ].filter((item) => item.value > 0);

      return {
        total: data.length,
        overdue: overdue.length,
        sent: sent.length,
        pending,
        totalAmount: data.reduce((sum, record) => sum + Number(record.amount), 0),
        overdueAmount: overdue.reduce((sum, record) => sum + Number(record.amount), 0),
        monthlyData,
        statusData,
      };
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

      if (error) {
        throw error;
      }

      return data || [];
    },
  });

  const { data: emailCount = 0 } = useQuery({
    queryKey: ['email-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('email_logs').select('*', { count: 'exact', head: true });
      if (error) {
        throw error;
      }
      return count || 0;
    },
  });

  const stats = [
    {
      title: 'Clientes',
      value: String(clients),
      subtitle: 'Base jurídica cadastrada',
      icon: Users,
      color: 'text-accent',
    },
    {
      title: 'Cobranças',
      value: String(billingStats?.total ?? 0),
      subtitle: `${billingStats?.pending ?? 0} pendentes agora`,
      icon: Clock,
      color: 'text-warning',
    },
    {
      title: 'Vencidas',
      value: String(billingStats?.overdue ?? 0),
      subtitle: billingStats?.overdueAmount ? formatCurrency(billingStats.overdueAmount) : 'Sem valor em atraso',
      icon: AlertTriangle,
      color: 'text-destructive',
    },
    {
      title: 'Valor total',
      value: formatCurrency(billingStats?.totalAmount ?? 0),
      subtitle: 'Soma das cobranças lidas',
      icon: DollarSign,
      color: 'text-success',
    },
    {
      title: 'E-mails enviados',
      value: String(emailCount),
      subtitle: `${billingStats?.sent ?? 0} marcados como enviados`,
      icon: Send,
      color: 'text-accent',
    },
    {
      title: 'Taxa de envio',
      value: billingStats?.total ? `${Math.round(((billingStats.sent ?? 0) / billingStats.total) * 100)}%` : '0%',
      subtitle: 'Baseado no total de cobranças',
      icon: TrendingUp,
      color: 'text-success',
    },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-[linear-gradient(135deg,rgba(18,31,49,0.96),rgba(28,46,73,0.88))] text-white shadow-[0_26px_80px_rgba(15,23,42,0.18)]">
        <div className="grid gap-8 px-6 py-7 lg:grid-cols-[1.2fr_0.8fr] lg:px-8">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-300">Modaelli Advogados</p>
            <div className="space-y-3">
              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Centro de controle das cobranças e relações com clientes.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                Acompanhe o volume de cobranças, o histórico de comunicações e os acessos pendentes em um ambiente
                alinhado à linguagem institucional do escritório.
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-[1.4rem] border border-white/10 bg-white/5 p-4 backdrop-blur sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Clientes ativos</p>
              <p className="mt-3 text-3xl font-semibold text-white">{clients}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">E-mails enviados</p>
              <p className="mt-3 text-3xl font-semibold text-white">{emailCount}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Pendentes</p>
              <p className="mt-3 text-3xl font-semibold text-white">{billingStats?.pending ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Valor total</p>
              <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(billingStats?.totalAmount ?? 0)}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
          <p className="mt-1 text-sm text-muted-foreground">Visão geral da operação financeira e dos envios recentes.</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => navigate('/cobrancas')}
            className="gap-2 rounded-xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(216_48%_34%))] shadow-[0_14px_30px_rgba(18,32,52,0.18)]"
          >
            <Upload className="h-4 w-4" />
            Enviar novo PDF
          </Button>
          <Button variant="outline" onClick={() => navigate('/clientes')} className="gap-2 rounded-xl border-border/70">
            <UserPlus className="h-4 w-4" />
            Gerenciar clientes
          </Button>
        </div>
      </div>

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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => (
          <Card
            key={stat.title}
            className="border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,249,252,0.96))] shadow-[0_12px_28px_rgba(15,23,42,0.06)] dark:bg-[linear-gradient(180deg,rgba(19,28,42,0.96),rgba(15,23,36,0.96))]"
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">{stat.title}</CardTitle>
              <div className="rounded-full bg-primary/10 p-2">
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tracking-tight">{stat.value}</div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{stat.subtitle}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BarChart3 className="h-5 w-5 text-accent" />
              Resumo operacional
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-sm text-muted-foreground">Pendentes</p>
              <p className="mt-2 text-2xl font-semibold">{billingStats?.pending ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">Ainda não enviadas e fora do atraso.</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-sm text-muted-foreground">Em atraso</p>
              <p className="mt-2 text-2xl font-semibold">{billingStats?.overdue ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {billingStats?.overdueAmount ? formatCurrency(billingStats.overdueAmount) : 'Nenhum valor em atraso.'}
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-sm text-muted-foreground">Histórico de envios</p>
              <p className="mt-2 text-2xl font-semibold">{emailCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">Total registrado na tabela de logs.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
          <CardHeader>
            <CardTitle className="text-lg">Acoes rapidas</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              onClick={() => navigate('/cobrancas')}
              className="justify-start gap-2 rounded-xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(216_48%_34%))]"
            >
              <Upload className="h-4 w-4" />
              Fazer upload de PDF
            </Button>
            <Button variant="outline" onClick={() => navigate('/clientes')} className="justify-start gap-2 rounded-xl">
              <UserPlus className="h-4 w-4" />
              Cadastrar cliente
            </Button>
            <Button variant="outline" onClick={() => navigate('/historico')} className="justify-start gap-2 rounded-xl">
              <Send className="h-4 w-4" />
              Ver histórico de envios
            </Button>
            {isAdmin ? (
              <Button variant="outline" onClick={() => navigate('/acessos')} className="justify-start gap-2 rounded-xl">
                <ShieldAlert className="h-4 w-4" />
                Aprovar novos acessos
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
          <CardHeader>
            <CardTitle className="text-lg">Cobranças por mês</CardTitle>
          </CardHeader>
          <CardContent>
            {billingStats?.monthlyData && billingStats.monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={billingStats.monthlyData}>
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => `R$${(Number(value) / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value: number) => [formatCurrency(value), 'Total']} />
                  <Bar dataKey="total" fill="hsl(214 53% 42%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">Nenhum dado disponível ainda.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
          <CardHeader>
            <CardTitle className="text-lg">Status das cobranças</CardTitle>
          </CardHeader>
          <CardContent>
            {billingStats?.statusData && billingStats.statusData.length > 0 ? (
              <div className="flex items-center justify-center">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={billingStats.statusData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={82}
                      label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                    >
                      {billingStats.statusData.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">Nenhum dado disponível ainda.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
        <CardHeader>
          <CardTitle className="text-lg">Últimos e-mails enviados</CardTitle>
        </CardHeader>
        <CardContent>
          {recentEmails.length > 0 ? (
            <div className="space-y-3">
              {recentEmails.map((log: any) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/70 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{log.client_name}</p>
                    <p className="text-xs text-muted-foreground">{log.client_email}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{formatCurrency(Number(log.amount))}</p>
                    <p className="text-xs text-muted-foreground">{new Date(log.sent_at).toLocaleDateString('pt-BR')}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum e-mail enviado ainda.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
