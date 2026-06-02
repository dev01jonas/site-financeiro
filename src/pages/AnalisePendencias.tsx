import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Download,
  FileText,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { BillingRecord, Client } from '@/types/billing';

type PendingStatus = 'pendente' | 'em_analise' | 'resolvido' | 'atrasado';
type Priority = 'baixa' | 'media' | 'alta' | 'critica';

type PendingItem = {
  id: string;
  client_id: string | null;
  nome_pessoa: string;
  tipo_pendencia: string;
  descricao: string;
  valor: number | null;
  data_vencimento: string | null;
  status: PendingStatus;
  observacoes: string | null;
  prioridade: Priority;
  created_at: string;
  updated_at: string;
};

type AnalysisRow = {
  id: string;
  source: 'manual' | 'billing';
  clientName: string;
  type: string;
  description: string;
  amount: number | null;
  date: string | null;
  status: PendingStatus;
  observations: string;
  updatedAt: string;
  priority: Priority;
  signals: string[];
  rawManual?: PendingItem;
};

const STATUS_LABELS: Record<PendingStatus, string> = {
  pendente: 'Pendente',
  em_analise: 'Em análise',
  resolvido: 'Resolvido',
  atrasado: 'Atrasado',
};

const PRIORITY_LABELS: Record<Priority, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  critica: 'Crítica',
};

const DEFAULT_FORM = {
  tipo_pendencia: 'Financeira',
  descricao: '',
  valor: '',
  data_vencimento: '',
  status: 'pendente' as PendingStatus,
  prioridade: 'media' as Priority,
  observacoes: '',
};

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function parseDate(value: string | null) {
  if (!value) return null;

  if (value.includes('/')) {
    const [day, month, year] = value.split('/').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }

  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function formatDate(value: string | null) {
  const date = parseDate(value);
  return date ? date.toLocaleDateString('pt-BR') : 'Sem data';
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('pt-BR');
}

function formatCurrency(value: number | null) {
  if (value === null || Number.isNaN(value)) return 'Sem valor';
  return `R$ ${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

function parseCurrency(value: string) {
  const normalized = value.replace(/\./g, '').replace(',', '.').trim();
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function daysFromNow(value: string | null) {
  const date = parseDate(value);
  if (!date) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function daysSince(value: string) {
  const date = new Date(value);
  const today = new Date();
  return Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function getAutomaticStatus(status: PendingStatus, dueDate: string | null) {
  if (status === 'resolvido') return 'resolvido';

  const diff = daysFromNow(dueDate);
  if (diff !== null && diff < 0) return 'atrasado';
  return status;
}

function classifyManual(item: PendingItem): AnalysisRow {
  const status = getAutomaticStatus(item.status, item.data_vencimento);
  const diff = daysFromNow(item.data_vencimento);
  const inactiveDays = daysSince(item.updated_at);
  const signals = [];

  if (status === 'atrasado') signals.push('Em atraso');
  if (diff !== null && diff >= 0 && diff <= 7 && status !== 'resolvido') signals.push('Próxima do vencimento');
  if (status === 'resolvido') signals.push('Resolvida');
  if (inactiveDays >= 15 && status !== 'resolvido') signals.push('Sem atualização recente');
  if (item.prioridade === 'critica' || (status === 'atrasado' && Number(item.valor || 0) >= 1000)) signals.push('Crítica');

  return {
    id: item.id,
    source: 'manual',
    clientName: item.nome_pessoa,
    type: item.tipo_pendencia,
    description: item.descricao,
    amount: item.valor,
    date: item.data_vencimento,
    status,
    observations: item.observacoes || 'Sem observações.',
    updatedAt: item.updated_at,
    priority: item.prioridade,
    signals,
    rawManual: item,
  };
}

function classifyBilling(record: BillingRecord): AnalysisRow {
  const paid = record.payment_status === 'paid';
  const cancelled = record.payment_status === 'cancelled';
  const diff = daysFromNow(record.due_date);
  const status: PendingStatus = paid || cancelled ? 'resolvido' : diff !== null && diff < 0 ? 'atrasado' : record.status === 'sent' ? 'em_analise' : 'pendente';
  const signals = [];

  if (status === 'atrasado') signals.push('Em atraso');
  if (diff !== null && diff >= 0 && diff <= 7 && status !== 'resolvido') signals.push('Próxima do vencimento');
  if (status === 'resolvido') signals.push('Resolvida');
  if (record.priority === 'alta' || (status === 'atrasado' && Number(record.amount) >= 1000)) signals.push('Crítica');

  return {
    id: `billing-${record.id}`,
    source: 'billing',
    clientName: record.client_name,
    type: record.payment_method === 'boleto' ? 'Boleto simples' : record.payment_method === 'pix' ? 'PIX' : 'Cobrança financeira',
    description: `Cobrança registrada no financeiro com vencimento em ${record.due_date}.`,
    amount: Number(record.amount),
    date: record.due_date,
    status,
    observations: record.payment_notes || (record.client_email ? `E-mail vinculado: ${record.client_email}` : 'Sem e-mail vinculado.'),
    updatedAt: record.paid_at || record.created_at || new Date().toISOString(),
    priority: record.priority === 'alta' ? 'alta' : 'media',
    signals,
  };
}

function getStatusVariant(status: PendingStatus) {
  if (status === 'resolvido') return 'default';
  if (status === 'atrasado') return 'destructive';
  if (status === 'em_analise') return 'secondary';
  return 'outline';
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildConclusion(rows: AnalysisRow[]) {
  const open = rows.filter((row) => row.status !== 'resolvido').length;
  const overdue = rows.filter((row) => row.status === 'atrasado').length;
  const critical = rows.filter((row) => row.signals.includes('Crítica')).length;

  if (rows.length === 0) return 'Não foram localizadas pendências para a pessoa selecionada.';
  if (critical > 0) return `A análise indica ${critical} pendência(s) crítica(s). Recomenda-se priorizar contato e atualização do histórico.`;
  if (overdue > 0) return `A análise indica ${overdue} pendência(s) em atraso. Recomenda-se regularização e acompanhamento próximo.`;
  if (open > 0) return `Existem ${open} pendência(s) em aberto, sem criticidade alta no momento.`;
  return 'Todas as pendências localizadas estão resolvidas.';
}

function exportAsDoc(client: Client, rows: AnalysisRow[]) {
  const generatedAt = new Date().toLocaleString('pt-BR');
  const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const conclusion = buildConclusion(rows);
  const tableRows = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.type)}</td>
          <td>${escapeHtml(row.description)}</td>
          <td>${escapeHtml(formatCurrency(row.amount))}</td>
          <td>${escapeHtml(formatDate(row.date))}</td>
          <td>${escapeHtml(STATUS_LABELS[row.status])}</td>
          <td>${escapeHtml(row.observations)}</td>
          <td>${escapeHtml(formatDateTime(row.updatedAt))}</td>
        </tr>
      `,
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <title>Análise de Pendências - ${escapeHtml(client.name)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #172033; line-height: 1.5; }
          h1 { color: #172842; margin-bottom: 4px; }
          .muted { color: #667085; }
          .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 22px 0; }
          .card { border: 1px solid #d9e2ef; border-radius: 12px; padding: 12px; background: #f8fafc; }
          .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #667085; }
          .value { font-size: 20px; font-weight: 700; margin-top: 6px; }
          table { width: 100%; border-collapse: collapse; margin-top: 18px; }
          th, td { border: 1px solid #d9e2ef; padding: 8px; font-size: 12px; vertical-align: top; }
          th { background: #172842; color: #ffffff; text-align: left; }
          .conclusion { margin-top: 22px; padding: 14px; border-left: 4px solid #172842; background: #eef2f7; }
        </style>
      </head>
      <body>
        <h1>Análise de Pendências</h1>
        <p class="muted">Modaelli Advogados · Documento gerado em ${escapeHtml(generatedAt)}</p>
        <h2>${escapeHtml(client.name)}</h2>
        <p><strong>E-mail:</strong> ${escapeHtml(client.email || 'Não informado')}</p>
        <div class="summary">
          <div class="card"><div class="label">Total</div><div class="value">${rows.length}</div></div>
          <div class="card"><div class="label">Em atraso</div><div class="value">${rows.filter((row) => row.status === 'atrasado').length}</div></div>
          <div class="card"><div class="label">Resolvidas</div><div class="value">${rows.filter((row) => row.status === 'resolvido').length}</div></div>
          <div class="card"><div class="label">Valor pendente</div><div class="value">${escapeHtml(formatCurrency(total))}</div></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Descrição</th>
              <th>Valor</th>
              <th>Data</th>
              <th>Status</th>
              <th>Observações</th>
              <th>Última atualização</th>
            </tr>
          </thead>
          <tbody>${tableRows || '<tr><td colspan="7">Nenhuma pendência localizada.</td></tr>'}</tbody>
        </table>
        <div class="conclusion"><strong>Conclusão automática:</strong> ${escapeHtml(conclusion)}</div>
      </body>
    </html>
  `;

  const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `analise-pendencias-${normalizeText(client.name).replace(/\s+/g, '-')}.doc`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function AnalisePendencias() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [form, setForm] = useState(DEFAULT_FORM);

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name, email, phone').order('name');
      if (error) throw error;
      return data as Client[];
    },
  });

  const { data: pendingItems = [] } = useQuery({
    queryKey: ['pending-items'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pending_items').select('*').order('updated_at', { ascending: false });
      if (error) throw error;
      return data as PendingItem[];
    },
  });

  const { data: billingRecords = [] } = useQuery({
    queryKey: ['billing-records-for-pending-analysis'],
    queryFn: async () => {
      const { data, error } = await supabase.from('billing_records').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as BillingRecord[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel('pending-analysis-live-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_items' }, () => {
        queryClient.invalidateQueries({ queryKey: ['pending-items'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard-pending-items'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'billing_records' }, () => {
        queryClient.invalidateQueries({ queryKey: ['billing-records-for-pending-analysis'] });
        queryClient.invalidateQueries({ queryKey: ['billing-dashboard-records'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const filteredClients = useMemo(() => {
    const query = normalizeText(search);
    if (!query) return clients.slice(0, 8);
    return clients.filter((client) => normalizeText(client.name).includes(query)).slice(0, 12);
  }, [clients, search]);

  const selectedClient = clients.find((client) => client.id === selectedClientId) || null;
  const selectedName = selectedClient ? normalizeText(selectedClient.name) : '';

  const analysisRows = useMemo(() => {
    if (!selectedClient) return [];

    const manual = pendingItems
      .filter((item) => item.client_id === selectedClient.id || normalizeText(item.nome_pessoa) === selectedName)
      .map(classifyManual);

    const financial = billingRecords
      .filter((record) => normalizeText(record.client_name) === selectedName || record.client_email === selectedClient.email)
      .map(classifyBilling);

    return [...manual, ...financial].sort((a, b) => {
      if (a.status === 'atrasado' && b.status !== 'atrasado') return -1;
      if (a.status !== 'atrasado' && b.status === 'atrasado') return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [billingRecords, pendingItems, selectedClient, selectedName]);

  const summary = useMemo(() => {
    const openRows = analysisRows.filter((row) => row.status !== 'resolvido');
    return {
      total: analysisRows.length,
      overdue: analysisRows.filter((row) => row.status === 'atrasado').length,
      upcoming: analysisRows.filter((row) => row.signals.includes('Próxima do vencimento')).length,
      resolved: analysisRows.filter((row) => row.status === 'resolvido').length,
      stale: analysisRows.filter((row) => row.signals.includes('Sem atualização recente')).length,
      critical: analysisRows.filter((row) => row.signals.includes('Crítica')).length,
      pendingAmount: openRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    };
  }, [analysisRows]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedClient) throw new Error('Selecione uma pessoa antes de cadastrar a pendência.');
      if (!form.descricao.trim()) throw new Error('Descreva a pendência para salvar.');

      const { error } = await supabase.from('pending_items').insert({
        client_id: selectedClient.id,
        nome_pessoa: selectedClient.name,
        tipo_pendencia: form.tipo_pendencia.trim() || 'Financeira',
        descricao: form.descricao.trim(),
        valor: form.valor ? parseCurrency(form.valor) : null,
        data_vencimento: form.data_vencimento || null,
        status: form.status,
        observacoes: form.observacoes.trim() || null,
        prioridade: form.prioridade,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      setForm(DEFAULT_FORM);
      queryClient.invalidateQueries({ queryKey: ['pending-items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-pending-items'] });
      toast({ title: 'Pendência cadastrada' });
    },
    onError: (error) => {
      toast({
        title: 'Não foi possível salvar a pendência',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ row, status }: { row: AnalysisRow; status: PendingStatus }) => {
      if (row.source !== 'manual' || !row.rawManual) return;
      const { error } = await supabase.from('pending_items').update({ status }).eq('id', row.rawManual.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-pending-items'] });
      toast({ title: 'Status atualizado' });
    },
    onError: (error) => {
      toast({
        title: 'Não foi possível atualizar',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      });
    },
  });

  const selectedConclusion = buildConclusion(analysisRows);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-[linear-gradient(135deg,rgba(18,31,49,0.96),rgba(28,46,73,0.88))] text-white shadow-[0_26px_80px_rgba(15,23,42,0.18)]">
        <div className="grid gap-8 px-6 py-7 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-300">Análise de Pendências</p>
            <div className="space-y-3">
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Consolide pendências por pessoa com leitura automática de risco.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                Busque um cliente cadastrado, veja cobranças vinculadas, cadastre pendências complementares e exporte um
                documento para acompanhamento interno.
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-[1.4rem] border border-white/10 bg-white/5 p-4 backdrop-blur sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Pessoa analisada</p>
              <p className="mt-3 text-2xl font-semibold text-white">{selectedClient?.name || 'Nenhuma selecionada'}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Pendências</p>
              <p className="mt-3 text-3xl font-semibold text-white">{summary.total}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Críticas</p>
              <p className="mt-3 text-3xl font-semibold text-white">{summary.critical}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
        <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="h-5 w-5 text-accent" />
              Buscar pessoa
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Digite o nome cadastrado..." />
            <div className="space-y-2">
              {filteredClients.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => {
                    setSelectedClientId(client.id);
                    setSearch(client.name);
                  }}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    selectedClientId === client.id
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-border/70 bg-background/80 hover:border-primary/30'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                      <UserRound className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium">{client.name}</p>
                      <p className="text-xs text-muted-foreground">{client.email}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-border/70 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-semibold">{summary.total}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/70 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-2xl bg-destructive/10 p-3 text-destructive">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Atrasadas</p>
                <p className="text-2xl font-semibold">{summary.overdue}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/70 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Resolvidas</p>
                <p className="text-2xl font-semibold">{summary.resolved}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/70 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-600">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Próximas</p>
                <p className="text-2xl font-semibold">{summary.upcoming}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/70 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                <RefreshCw className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Sem atualização</p>
                <p className="text-2xl font-semibold">{summary.stale}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/70 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Valor pendente</p>
                <p className="text-2xl font-semibold">{formatCurrency(summary.pendingAmount)}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
        <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-lg">Cadastrar pendência</CardTitle>
            <p className="text-sm text-muted-foreground">Use para registrar pendências que ainda não existem nas cobranças financeiras.</p>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <Input
              value={form.tipo_pendencia}
              onChange={(event) => setForm((current) => ({ ...current, tipo_pendencia: event.target.value }))}
              placeholder="Tipo de pendência"
              disabled={!selectedClient}
            />
            <Textarea
              value={form.descricao}
              onChange={(event) => setForm((current) => ({ ...current, descricao: event.target.value }))}
              placeholder="Descrição da pendência"
              rows={4}
              disabled={!selectedClient}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                value={form.valor}
                onChange={(event) => setForm((current) => ({ ...current, valor: event.target.value }))}
                placeholder="Valor"
                inputMode="decimal"
                disabled={!selectedClient}
              />
              <Input
                value={form.data_vencimento}
                onChange={(event) => setForm((current) => ({ ...current, data_vencimento: event.target.value }))}
                type="date"
                disabled={!selectedClient}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value as PendingStatus }))} disabled={!selectedClient}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="em_analise">Em análise</SelectItem>
                  <SelectItem value="resolvido">Resolvido</SelectItem>
                  <SelectItem value="atrasado">Atrasado</SelectItem>
                </SelectContent>
              </Select>
              <Select value={form.prioridade} onValueChange={(value) => setForm((current) => ({ ...current, prioridade: value as Priority }))} disabled={!selectedClient}>
                <SelectTrigger>
                  <SelectValue placeholder="Prioridade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="media">Média</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="critica">Crítica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              value={form.observacoes}
              onChange={(event) => setForm((current) => ({ ...current, observacoes: event.target.value }))}
              placeholder="Observações"
              rows={3}
              disabled={!selectedClient}
            />
            <Button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={!selectedClient || createMutation.isPending}
              className="w-full rounded-xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(216_48%_34%))]"
            >
              {createMutation.isPending ? 'Salvando...' : 'Salvar pendência'}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShieldAlert className="h-5 w-5 text-accent" />
                  Pendências vinculadas
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{selectedConclusion}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                disabled={!selectedClient}
                onClick={() => selectedClient && exportAsDoc(selectedClient, analysisRows)}
              >
                <Download className="mr-2 h-4 w-4" />
                Exportar DOC
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            <div className="overflow-hidden rounded-[1.35rem] border border-border/70">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Observações</TableHead>
                    <TableHead>Última atualização</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!selectedClient ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                        Selecione uma pessoa cadastrada para iniciar a análise.
                      </TableCell>
                    </TableRow>
                  ) : analysisRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                        Nenhuma pendência encontrada para essa pessoa.
                      </TableCell>
                    </TableRow>
                  ) : (
                    analysisRows.map((row) => (
                      <TableRow key={row.id} className="bg-background/70 align-top">
                        <TableCell className="min-w-[150px] font-medium">{row.clientName}</TableCell>
                        <TableCell className="min-w-[130px]">
                          <div className="space-y-2">
                            <span>{row.type}</span>
                            <Badge variant="outline">{row.source === 'billing' ? 'Financeiro' : 'Manual'}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="min-w-[240px]">{row.description}</TableCell>
                        <TableCell className="min-w-[120px]">{formatCurrency(row.amount)}</TableCell>
                        <TableCell className="min-w-[110px]">{formatDate(row.date)}</TableCell>
                        <TableCell className="min-w-[120px]">
                          <Badge variant={getStatusVariant(row.status)}>{STATUS_LABELS[row.status]}</Badge>
                        </TableCell>
                        <TableCell className="min-w-[220px]">
                          <div className="space-y-2">
                            <p>{row.observations}</p>
                            <div className="flex flex-wrap gap-1">
                              {row.signals.map((signal) => (
                                <Badge key={signal} variant="outline">
                                  {signal}
                                </Badge>
                              ))}
                              <Badge variant="outline">Prioridade {PRIORITY_LABELS[row.priority]}</Badge>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="min-w-[150px]">{formatDateTime(row.updatedAt)}</TableCell>
                        <TableCell className="min-w-[170px]">
                          {row.source === 'manual' ? (
                            <Select
                              value={row.rawManual?.status || row.status}
                              onValueChange={(value) => updateStatusMutation.mutate({ row, status: value as PendingStatus })}
                              disabled={updateStatusMutation.isPending}
                            >
                              <SelectTrigger className="h-9 rounded-xl">
                                <SelectValue placeholder="Atualizar" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pendente">Pendente</SelectItem>
                                <SelectItem value="em_analise">Em análise</SelectItem>
                                <SelectItem value="resolvido">Resolvido</SelectItem>
                                <SelectItem value="atrasado">Atrasado</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-muted-foreground">Atualize pela cobrança.</span>
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
    </div>
  );
}
