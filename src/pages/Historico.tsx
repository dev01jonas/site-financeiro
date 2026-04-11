import { useQuery } from '@tanstack/react-query';
import { Clock3, Mail, ReceiptText, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export default function Historico() {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['email-logs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('email_logs').select('*').order('sent_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const successCount = logs.filter((log) => log.status === 'sent').length;
  const failedCount = logs.filter((log) => log.status !== 'sent').length;
  const totalAmount = logs.reduce((sum, log) => sum + Number(log.amount), 0);

  const summaryCards = [
    {
      title: 'Envios registrados',
      value: logs.length,
      subtitle: 'Histórico consolidado da comunicação.',
      icon: Send,
    },
    {
      title: 'Entregas com sucesso',
      value: successCount,
      subtitle: 'Mensagens registradas como enviadas.',
      icon: Mail,
    },
    {
      title: 'Valor comunicado',
      value: `R$ ${totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      subtitle: 'Soma financeira dos disparos armazenados.',
      icon: ReceiptText,
    },
    {
      title: 'Falhas',
      value: failedCount,
      subtitle: 'Demandam revisão do cadastro ou do envio.',
      icon: Clock3,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-[linear-gradient(135deg,rgba(18,31,49,0.96),rgba(28,46,73,0.88))] text-white shadow-[0_26px_80px_rgba(15,23,42,0.18)]">
        <div className="grid gap-8 px-6 py-7 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-300">Histórico de comunicações</p>
            <div className="space-y-3">
              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Visao institucional dos e-mails enviados e da trilha operacional.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                Consulte rapidamente os disparos já registrados, acompanhe valores comunicados e mantenha uma leitura
                clara do relacionamento financeiro com cada cliente.
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-[1.4rem] border border-white/10 bg-white/5 p-4 backdrop-blur sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Linhas de histórico</p>
              <p className="mt-3 text-3xl font-semibold text-white">{logs.length}</p>
              <p className="mt-2 text-sm text-slate-300">registros prontos para auditoria interna e consulta.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Sucesso</p>
              <p className="mt-3 text-3xl font-semibold text-white">{successCount}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Falhas</p>
              <p className="mt-3 text-3xl font-semibold text-white">{failedCount}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        {summaryCards.map((card) => (
          <Card
            key={card.title}
            className="border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,249,252,0.96))] shadow-[0_12px_28px_rgba(15,23,42,0.06)] dark:bg-[linear-gradient(180deg,rgba(19,28,42,0.96),rgba(15,23,36,0.96))]"
          >
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                <card.icon className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{card.title}</p>
                <p className="text-2xl font-semibold tracking-tight">{card.value}</p>
                <p className="text-xs text-muted-foreground">{card.subtitle}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="space-y-1">
            <CardTitle className="text-lg">Histórico detalhado</CardTitle>
            <p className="text-sm text-muted-foreground">
              Acompanhamento cronológico dos e-mails disparados e dos respectivos status.
            </p>
          </div>
        </CardHeader>

        <CardContent className="p-5">
          <div className="overflow-hidden rounded-[1.35rem] border border-border/70">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Enviado em</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      Nenhum e-mail enviado ainda.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id} className="bg-background/70">
                      <TableCell className="font-medium">{log.client_name}</TableCell>
                      <TableCell>{log.client_email}</TableCell>
                      <TableCell>R$ {Number(log.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>{log.due_date}</TableCell>
                      <TableCell>{new Date(log.sent_at).toLocaleString('pt-BR')}</TableCell>
                      <TableCell>
                        <Badge variant={log.status === 'sent' ? 'default' : 'destructive'}>
                          {log.status === 'sent' ? 'Enviado' : 'Falhou'}
                        </Badge>
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
