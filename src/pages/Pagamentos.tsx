import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { BillingRecord } from '@/types/billing';
import { AlertCircle, CheckCircle2, Copy, FileText, Landmark, Mail, PhoneCall, PlusCircle, QrCode, RotateCcw, UserCircle2 } from 'lucide-react';

type PaymentMethod = 'pix' | 'boleto';
type PaymentStatus = 'pending' | 'paid' | 'cancelled';
type CollectionStage = 'nova' | 'em_cobranca' | 'aguardando_pagamento' | 'paga' | 'atrasada' | 'cancelada';
type Priority = 'baixa' | 'media' | 'alta';

const COMPANY_NAME = 'Modaelli Sociedade de Advogados';
const COMPANY_DOCUMENT = '48.697.725/0001-07';
const DEFAULT_PIX_KEY = '48.697.725/0001-07';
const LOCAL_STORAGE_KEY = 'manual-payments-fallback';
const DEFAULT_COLLECTION_STAGE: CollectionStage = 'nova';
const DEFAULT_PRIORITY: Priority = 'media';

const STAGE_LABELS: Record<CollectionStage, string> = {
  nova: 'Nova',
  em_cobranca: 'Em cobranca',
  aguardando_pagamento: 'Aguardando pagamento',
  paga: 'Paga',
  atrasada: 'Atrasada',
  cancelada: 'Cancelada',
};

const PRIORITY_LABELS: Record<Priority, string> = {
  baixa: 'Baixa',
  media: 'Media',
  alta: 'Alta',
};

function formatCurrency(value: number) {
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

function formatDateToBr(value: string) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function generateReference(prefix: 'BOL' | 'PIX') {
  const stamp = Date.now().toString().slice(-8);
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${stamp}-${random}`;
}

function buildPixPayload(clientName: string, amount: number, dueDate: string, pixKey: string) {
  return [
    `Favorecido: ${COMPANY_NAME}`,
    `CNPJ/Chave PIX: ${pixKey}`,
    `Cliente: ${clientName}`,
    `Valor: ${formatCurrency(amount)}`,
    `Vencimento: ${dueDate}`,
    'Tipo: PIX manual',
  ].join('\n');
}

function buildBoletoHtml(record: BillingRecord) {
  const amount = formatCurrency(record.amount);
  const issueDate = new Date(record.created_at || new Date().toISOString()).toLocaleDateString('pt-BR');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8" /><title>Boleto Simples - ${record.client_name}</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#0f172a}.sheet{max-width:860px;margin:0 auto;border:1px solid #cbd5e1;border-radius:16px;overflow:hidden}.header{background:#1e293b;color:white;padding:24px 28px}.body{padding:28px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}.card{border:1px solid #cbd5e1;border-radius:12px;padding:16px;background:#f8fafc}.label{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:8px}.value{font-size:18px;font-weight:700}.notice{border-top:1px solid #cbd5e1;margin-top:24px;padding-top:18px;color:#475569;line-height:1.6}.reference{font-size:28px;font-weight:700;letter-spacing:2px;margin-top:8px}</style></head><body><div class="sheet"><div class="header"><div style="font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:#cbd5e1;">Boleto simples</div><h1 style="margin:8px 0 0;">${COMPANY_NAME}</h1><p style="margin:8px 0 0;color:#dbe4f0;">Documento interno para envio e controle manual da cobranca.</p></div><div class="body"><div class="grid"><div class="card"><div class="label">Cliente</div><div class="value">${record.client_name}</div></div><div class="card"><div class="label">Valor</div><div class="value">${amount}</div></div><div class="card"><div class="label">Vencimento</div><div class="value">${record.due_date}</div></div><div class="card"><div class="label">Emissao</div><div class="value">${issueDate}</div></div></div><div class="card"><div class="label">Referencia de cobranca</div><div class="reference">${record.boleto_reference || 'PENDENTE'}</div></div><div class="notice"><p><strong>Favorecido:</strong> ${COMPANY_NAME}</p><p><strong>CNPJ:</strong> ${COMPANY_DOCUMENT}</p><p><strong>Observacao:</strong> este boleto simples serve para organizacao interna e envio manual. Para registro bancario automatico e compensacao em banco, sera necessaria integracao externa em uma proxima etapa.</p></div></div></div></body></html>`;
}

function buildEmailMessage(record: BillingRecord) {
  const base = [`Ola, ${record.client_name}. Tudo bem?`, '', `Segue a cobranca no valor de ${formatCurrency(record.amount)}, com vencimento em ${record.due_date}.`, ''];
  if (record.payment_method === 'pix') {
    return [...base, 'Forma de pagamento: PIX', `Chave PIX: ${record.pix_key || DEFAULT_PIX_KEY}`, '', 'Se preferir, responda este e-mail com o comprovante para registrarmos a baixa.', '', 'Atenciosamente,', 'Equipe Financeira'].join('\n');
  }
  return [...base, 'Forma de pagamento: boleto simples', `Referencia: ${record.boleto_reference || 'PENDENTE'}`, '', 'Caso precise, podemos reenviar o documento por este canal.', '', 'Atenciosamente,', 'Equipe Financeira'].join('\n');
}

function loadLocalRecords() {
  if (typeof window === 'undefined') return [] as BillingRecord[];
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BillingRecord[]) : [];
  } catch {
    return [];
  }
}

function saveLocalRecords(records: BillingRecord[]) {
  if (typeof window !== 'undefined') window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(records));
}

function isMissingPaymentSchema(message: string) {
  const lower = message.toLowerCase();
  return ['payment_method', 'payment_status', 'pix_copy_paste', 'pix_key', 'boleto_reference', 'paid_at', 'collection_stage', 'priority', 'assigned_to', 'last_contact_at', 'contact_attempts'].some((key) => lower.includes(key));
}

export default function Pagamentos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix');
  const [pixKey, setPixKey] = useState(DEFAULT_PIX_KEY);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [priority, setPriority] = useState<Priority>(DEFAULT_PRIORITY);
  const [fallbackMode, setFallbackMode] = useState(false);
  const [localRecords, setLocalRecords] = useState<BillingRecord[]>([]);

  useEffect(() => {
    setLocalRecords(loadLocalRecords());
  }, []);

  const paymentsQuery = useQuery({
    queryKey: ['manual-payments'],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('billing_records').select('*').not('payment_method', 'is', null).order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as BillingRecord[];
    },
  });

  useEffect(() => {
    if (!paymentsQuery.error) return;
    const message = paymentsQuery.error instanceof Error ? paymentsQuery.error.message : String(paymentsQuery.error);
    if (isMissingPaymentSchema(message)) setFallbackMode(true);
  }, [paymentsQuery.error]);

  const records = fallbackMode ? localRecords : paymentsQuery.data || [];
  const persistLocalRecords = (nextRecords: BillingRecord[]) => {
    setLocalRecords(nextRecords);
    saveLocalRecords(nextRecords);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const normalizedName = clientName.trim();
      const normalizedEmail = clientEmail.trim().toLowerCase();
      const normalizedAmount = Number(amount.replace(',', '.'));
      if (!normalizedName || !dueDate || !normalizedAmount) throw new Error('Preencha cliente, vencimento e valor para gerar a cobranca.');

      const dueDateBr = formatDateToBr(dueDate);
      const createdRecord: BillingRecord = {
        id: crypto.randomUUID(),
        client_name: normalizedName,
        client_email: normalizedEmail || undefined,
        due_date: dueDateBr,
        amount: normalizedAmount,
        created_at: new Date().toISOString(),
        status: 'matched',
        payment_method: paymentMethod,
        payment_status: 'pending',
        payment_notes: paymentNotes.trim() || null,
        pix_key: paymentMethod === 'pix' ? pixKey.trim() || DEFAULT_PIX_KEY : null,
        pix_copy_paste: paymentMethod === 'pix' ? buildPixPayload(normalizedName, normalizedAmount, dueDateBr, pixKey.trim() || DEFAULT_PIX_KEY) : null,
        boleto_reference: paymentMethod === 'boleto' ? generateReference('BOL') : null,
        collection_stage: DEFAULT_COLLECTION_STAGE,
        priority,
        assigned_to: assignedTo.trim() || null,
        last_contact_at: null,
        contact_attempts: 0,
      };

      if (fallbackMode) {
        persistLocalRecords([createdRecord, ...localRecords]);
        return createdRecord;
      }

      const { data, error } = await supabase.from('billing_records').insert(createdRecord).select('*').single();
      if (error) {
        if (isMissingPaymentSchema(error.message)) {
          setFallbackMode(true);
          persistLocalRecords([createdRecord, ...localRecords]);
          return createdRecord;
        }
        throw error;
      }
      return data as BillingRecord;
    },
    onSuccess: () => {
      setClientName('');
      setClientEmail('');
      setDueDate('');
      setAmount('');
      setPaymentNotes('');
      setAssignedTo('');
      setPriority(DEFAULT_PRIORITY);
      setPaymentMethod('pix');
      setPixKey(DEFAULT_PIX_KEY);
      queryClient.invalidateQueries({ queryKey: ['manual-payments'] });
      queryClient.invalidateQueries({ queryKey: ['billing-stats'] });
      toast({ title: fallbackMode ? 'Cobranca criada em modo local' : 'Cobranca criada com sucesso' });
    },
    onError: (error) => {
      toast({ title: 'Nao foi possivel criar a cobranca', description: error instanceof Error ? error.message : 'Tente novamente.', variant: 'destructive' });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, payment_status }: { id: string; payment_status: PaymentStatus }) => {
      const updates = {
        payment_status,
        paid_at: payment_status === 'paid' ? new Date().toISOString() : null,
        collection_stage: payment_status === 'paid' ? ('paga' as CollectionStage) : payment_status === 'cancelled' ? ('cancelada' as CollectionStage) : undefined,
      };
      if (fallbackMode) {
        persistLocalRecords(localRecords.map((record) => (record.id === id ? { ...record, ...updates } : record)));
        return;
      }
      const { error } = await supabase.from('billing_records').update(updates).eq('id', id);
      if (error) {
        if (isMissingPaymentSchema(error.message)) {
          setFallbackMode(true);
          persistLocalRecords(localRecords.map((record) => (record.id === id ? { ...record, ...updates } : record)));
          return;
        }
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manual-payments'] });
      queryClient.invalidateQueries({ queryKey: ['billing-stats'] });
      toast({ title: 'Status do pagamento atualizado' });
    },
    onError: (error) => {
      toast({ title: 'Nao foi possivel atualizar o pagamento', description: error instanceof Error ? error.message : 'Tente novamente.', variant: 'destructive' });
    },
  });

  const updateWorkflowMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Pick<BillingRecord, 'collection_stage' | 'priority' | 'assigned_to' | 'last_contact_at' | 'contact_attempts'>> }) => {
      if (fallbackMode) {
        persistLocalRecords(localRecords.map((record) => (record.id === id ? { ...record, ...updates } : record)));
        return;
      }
      const { error } = await supabase.from('billing_records').update(updates).eq('id', id);
      if (error) {
        if (isMissingPaymentSchema(error.message)) {
          setFallbackMode(true);
          persistLocalRecords(localRecords.map((record) => (record.id === id ? { ...record, ...updates } : record)));
          return;
        }
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manual-payments'] });
      toast({ title: 'Fluxo da cobranca atualizado' });
    },
    onError: (error) => {
      toast({ title: 'Nao foi possivel atualizar o fluxo', description: error instanceof Error ? error.message : 'Tente novamente.', variant: 'destructive' });
    },
  });

  const sendChargeMutation = useMutation({
    mutationFn: async (record: BillingRecord) => {
      if (!record.client_email) throw new Error('Informe um e-mail para o cliente antes de enviar a cobranca.');
      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-billing-email`;
      const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
        body: JSON.stringify({
          records: [{ client_name: record.client_name, client_email: record.client_email, due_date: record.due_date, amount: record.amount }],
          messageTemplate: buildEmailMessage(record),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload && typeof payload === 'object' ? payload.error || payload.message || payload.details : null;
        throw new Error(typeof detail === 'string' && detail.trim() ? detail : 'Falha ao enviar cobranca por e-mail.');
      }
      if (fallbackMode) persistLocalRecords(localRecords.map((item) => (item.id === record.id ? { ...item, status: 'sent' as const } : item)));
      else await supabase.from('billing_records').update({ status: 'sent' }).eq('id', record.id);
      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manual-payments'] });
      queryClient.invalidateQueries({ queryKey: ['recent-emails'] });
      queryClient.invalidateQueries({ queryKey: ['email-count'] });
      queryClient.invalidateQueries({ queryKey: ['email-logs'] });
      queryClient.invalidateQueries({ queryKey: ['billing-stats'] });
      toast({ title: 'Cobranca enviada por e-mail' });
    },
    onError: (error) => {
      toast({ title: 'Nao foi possivel enviar a cobranca', description: error instanceof Error ? error.message : 'Tente novamente.', variant: 'destructive' });
    },
  });

  const summary = useMemo(() => ({
    total: records.length,
    pending: records.filter((record) => record.payment_status === 'pending').length,
    paid: records.filter((record) => record.payment_status === 'paid').length,
    totalAmount: records.reduce((sum, record) => sum + Number(record.amount), 0),
    delayed: records.filter((record) => (record.collection_stage || DEFAULT_COLLECTION_STAGE) === 'atrasada').length,
  }), [records]);

  const stageCards = useMemo(() => (Object.keys(STAGE_LABELS) as CollectionStage[]).map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    count: records.filter((record) => (record.collection_stage || DEFAULT_COLLECTION_STAGE) === stage).length,
  })), [records]);

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copiado` });
    } catch {
      toast({ title: `Nao foi possivel copiar ${label.toLowerCase()}`, variant: 'destructive' });
    }
  };

  const openBoleto = (record: BillingRecord) => {
    const popup = window.open('', '_blank', 'width=980,height=760');
    if (!popup) {
      toast({ title: 'Libere pop-ups para abrir o boleto simples.', variant: 'destructive' });
      return;
    }
    popup.document.write(buildBoletoHtml(record));
    popup.document.close();
  };

  const showQueryError = paymentsQuery.error && !fallbackMode;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-[linear-gradient(135deg,rgba(18,31,49,0.96),rgba(28,46,73,0.88))] text-white shadow-[0_26px_80px_rgba(15,23,42,0.18)]">
        <div className="grid gap-8 px-6 py-7 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-300">Cobrancas manuais</p>
            <div className="space-y-3">
              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Controle seu contas a receber com etapas, prioridade e contatos.</h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-300">Esta etapa aproxima o fluxo do modelo Pipefy: responsavel, fase da cobranca, tentativa de contato e baixa.</p>
            </div>
          </div>
          <div className="grid gap-3 rounded-[1.4rem] border border-white/10 bg-white/5 p-4 backdrop-blur sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:col-span-2"><p className="text-xs uppercase tracking-[0.18em] text-slate-300">Cobrancas registradas</p><p className="mt-3 text-3xl font-semibold text-white">{summary.total}</p><p className="mt-2 text-sm text-slate-300">Fluxo manual centralizado para PIX, boleto simples e acompanhamento.</p></div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.18em] text-slate-300">Pendentes</p><p className="mt-3 text-3xl font-semibold text-white">{summary.pending}</p></div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.18em] text-slate-300">Pagas</p><p className="mt-3 text-3xl font-semibold text-white">{summary.paid}</p></div>
          </div>
        </div>
      </section>
      {fallbackMode ? <Card className="border-amber-300/70 bg-[linear-gradient(135deg,rgba(255,251,235,0.9),rgba(255,247,214,0.95))] shadow-sm"><CardContent className="flex items-start gap-3 p-5"><AlertCircle className="mt-0.5 h-5 w-5 text-amber-700" /><div><p className="font-medium text-amber-900">Modo local ativo para pagamentos.</p><p className="text-sm text-amber-800">A tela continua funcionando mesmo se o banco ainda nao tiver os campos novos.</p></div></CardContent></Card> : null}
      {showQueryError ? <Card className="border-destructive/40 shadow-[0_14px_36px_rgba(15,23,42,0.06)]"><CardContent className="p-5 text-sm text-muted-foreground">Nao foi possivel carregar pagamentos agora. Erro retornado: {paymentsQuery.error instanceof Error ? paymentsQuery.error.message : 'desconhecido'}.</CardContent></Card> : null}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-border/70 shadow-[0_12px_28px_rgba(15,23,42,0.06)]"><CardContent className="flex items-center gap-4 p-5"><div className="rounded-2xl bg-primary/10 p-3 text-primary"><Landmark className="h-5 w-5" /></div><div><p className="text-sm text-muted-foreground">Valor total</p><p className="text-2xl font-semibold">{formatCurrency(summary.totalAmount)}</p></div></CardContent></Card>
        <Card className="border-border/70 shadow-[0_12px_28px_rgba(15,23,42,0.06)]"><CardContent className="flex items-center gap-4 p-5"><div className="rounded-2xl bg-primary/10 p-3 text-primary"><QrCode className="h-5 w-5" /></div><div><p className="text-sm text-muted-foreground">PIX pendentes</p><p className="text-2xl font-semibold">{records.filter((record) => record.payment_method === 'pix' && record.payment_status === 'pending').length}</p></div></CardContent></Card>
        <Card className="border-border/70 shadow-[0_12px_28px_rgba(15,23,42,0.06)]"><CardContent className="flex items-center gap-4 p-5"><div className="rounded-2xl bg-primary/10 p-3 text-primary"><FileText className="h-5 w-5" /></div><div><p className="text-sm text-muted-foreground">Boletos simples</p><p className="text-2xl font-semibold">{records.filter((record) => record.payment_method === 'boleto').length}</p></div></CardContent></Card>
        <Card className="border-border/70 shadow-[0_12px_28px_rgba(15,23,42,0.06)]"><CardContent className="flex items-center gap-4 p-5"><div className="rounded-2xl bg-primary/10 p-3 text-primary"><CheckCircle2 className="h-5 w-5" /></div><div><p className="text-sm text-muted-foreground">Cobrancas atrasadas</p><p className="text-2xl font-semibold">{summary.delayed}</p></div></CardContent></Card>
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">{stageCards.map((item) => <Card key={item.stage} className="border-border/70 shadow-[0_12px_28px_rgba(15,23,42,0.06)]"><CardContent className="p-4"><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.label}</p><p className="mt-2 text-2xl font-semibold">{item.count}</p></CardContent></Card>)}</div>
      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><PlusCircle className="h-5 w-5 text-accent" />Nova cobranca manual</CardTitle></CardHeader><CardContent className="space-y-4"><Input value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="Nome do cliente" /><Input value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} placeholder="E-mail do cliente (opcional)" type="email" /><div className="grid gap-3 sm:grid-cols-2"><Input value={dueDate} onChange={(event) => setDueDate(event.target.value)} type="date" /><Input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Valor" inputMode="decimal" /></div><div className="grid gap-3 sm:grid-cols-2"><Input value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} placeholder="Responsavel pela cobranca" /><Select value={priority} onValueChange={(value) => setPriority(value as Priority)}><SelectTrigger><SelectValue placeholder="Prioridade" /></SelectTrigger><SelectContent><SelectItem value="baixa">Baixa</SelectItem><SelectItem value="media">Media</SelectItem><SelectItem value="alta">Alta</SelectItem></SelectContent></Select></div><Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}><SelectTrigger><SelectValue placeholder="Forma de pagamento" /></SelectTrigger><SelectContent><SelectItem value="pix">PIX</SelectItem><SelectItem value="boleto">Boleto simples</SelectItem></SelectContent></Select>{paymentMethod === 'pix' ? <Input value={pixKey} onChange={(event) => setPixKey(event.target.value)} placeholder="Chave PIX" /> : <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">O boleto desta etapa e um documento simples para impressao e envio manual, com referencia interna da cobranca.</div>}<Textarea value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} placeholder="Observacoes internas da cobranca" rows={5} /><Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="w-full rounded-xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(216_48%_34%))]">{createMutation.isPending ? 'Criando cobranca...' : 'Gerar cobranca'}</Button></CardContent></Card>
        <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]"><CardHeader className="border-b border-border/60 pb-4"><div className="space-y-1"><CardTitle className="text-lg">Cobrancas registradas</CardTitle><p className="text-sm text-muted-foreground">Copie o PIX, abra o boleto simples, avance etapas e registre contatos do processo.</p></div></CardHeader><CardContent className="p-5"><div className="overflow-hidden rounded-[1.35rem] border border-border/70"><Table><TableHeader className="bg-muted/40"><TableRow><TableHead>Cliente</TableHead><TableHead>Forma</TableHead><TableHead>Valor</TableHead><TableHead>Vencimento</TableHead><TableHead>Status</TableHead><TableHead>Fluxo</TableHead><TableHead>Acoes</TableHead></TableRow></TableHeader><TableBody>{paymentsQuery.isLoading && !fallbackMode ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Carregando...</TableCell></TableRow> : null}{!paymentsQuery.isLoading && records.length === 0 ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Nenhuma cobranca manual criada ainda.</TableCell></TableRow> : null}{records.map((record) => {const currentStage = (record.collection_stage || DEFAULT_COLLECTION_STAGE) as CollectionStage; const currentPriority = (record.priority || DEFAULT_PRIORITY) as Priority; return <TableRow key={record.id} className="bg-background/70 align-top"><TableCell><div className="space-y-1"><p className="font-medium">{record.client_name}</p><p className="text-xs text-muted-foreground">{record.client_email || 'Sem e-mail informado'}</p></div></TableCell><TableCell>{record.payment_method === 'pix' ? 'PIX' : 'Boleto'}</TableCell><TableCell>{formatCurrency(Number(record.amount))}</TableCell><TableCell>{record.due_date}</TableCell><TableCell><div className="space-y-2"><Badge variant={record.payment_status === 'paid' ? 'default' : record.payment_status === 'cancelled' ? 'outline' : 'secondary'}>{record.payment_status === 'paid' ? 'Pago' : record.payment_status === 'cancelled' ? 'Cancelado' : 'Pendente'}</Badge>{record.paid_at ? <p className="text-xs text-muted-foreground">Confirmado em {new Date(record.paid_at).toLocaleString('pt-BR')}</p> : null}</div></TableCell><TableCell><div className="min-w-[240px] space-y-2"><Select value={currentStage} onValueChange={(value) => updateWorkflowMutation.mutate({ id: record.id, updates: { collection_stage: value as CollectionStage } })}><SelectTrigger className="h-9 rounded-xl"><SelectValue placeholder="Etapa" /></SelectTrigger><SelectContent>{(Object.keys(STAGE_LABELS) as CollectionStage[]).map((stage) => <SelectItem key={stage} value={stage}>{STAGE_LABELS[stage]}</SelectItem>)}</SelectContent></Select><div className="flex flex-wrap gap-2"><Badge variant="outline">{PRIORITY_LABELS[currentPriority]}</Badge><Badge variant="outline">{record.assigned_to ? `Resp. ${record.assigned_to}` : 'Sem responsavel'}</Badge></div><p className="text-xs text-muted-foreground">{record.contact_attempts || 0} contato(s){record.last_contact_at ? ` • ultimo em ${new Date(record.last_contact_at).toLocaleDateString('pt-BR')}` : ''}</p></div></TableCell><TableCell><div className="flex min-w-[270px] flex-col gap-2">{record.payment_method === 'pix' && record.pix_copy_paste ? <Button variant="outline" size="sm" className="justify-start rounded-xl" onClick={() => copyText(record.pix_copy_paste || '', 'PIX')}><Copy className="mr-2 h-4 w-4" />Copiar PIX</Button> : null}{record.payment_method === 'boleto' ? <Button variant="outline" size="sm" className="justify-start rounded-xl" onClick={() => openBoleto(record)}><FileText className="mr-2 h-4 w-4" />Abrir boleto</Button> : null}<Button variant="outline" size="sm" className="justify-start rounded-xl" onClick={() => sendChargeMutation.mutate(record)} disabled={!record.client_email || sendChargeMutation.isPending}><Mail className="mr-2 h-4 w-4" />Enviar cobranca</Button><Button variant="outline" size="sm" className="justify-start rounded-xl" onClick={() => updateWorkflowMutation.mutate({ id: record.id, updates: { contact_attempts: (record.contact_attempts || 0) + 1, last_contact_at: new Date().toISOString(), collection_stage: currentStage === 'nova' ? 'em_cobranca' : currentStage } })} disabled={updateWorkflowMutation.isPending}><PhoneCall className="mr-2 h-4 w-4" />Registrar contato</Button><Button variant="outline" size="sm" className="justify-start rounded-xl" onClick={() => updateWorkflowMutation.mutate({ id: record.id, updates: { assigned_to: record.assigned_to ? null : 'Equipe Financeira', priority: currentPriority === 'alta' ? 'media' : 'alta' } })} disabled={updateWorkflowMutation.isPending}><UserCircle2 className="mr-2 h-4 w-4" />Priorizar e assumir</Button><Button size="sm" className="justify-start rounded-xl" onClick={() => statusMutation.mutate({ id: record.id, payment_status: 'paid' })} disabled={record.payment_status === 'paid' || statusMutation.isPending}><CheckCircle2 className="mr-2 h-4 w-4" />Confirmar pagamento</Button><Button variant="outline" size="sm" className="justify-start rounded-xl" onClick={() => statusMutation.mutate({ id: record.id, payment_status: 'pending' })} disabled={record.payment_status === 'pending' || statusMutation.isPending}><RotateCcw className="mr-2 h-4 w-4" />Reabrir cobranca</Button></div></TableCell></TableRow>;})}</TableBody></Table></div></CardContent></Card>
      </div>
    </div>
  );
}
