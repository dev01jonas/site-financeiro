import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileText,
  Link2,
  MessageSquare,
  Send,
  Upload,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import { extractBillingRecords, type ExtractedRecord } from '@/lib/pdf-extractor';
import { copyToClipboard, downloadCSV } from '@/lib/csv-utils';
import type { BillingRecord, Client } from '@/types/billing';
import Pagamentos from './Pagamentos';

type Filter = 'all' | 'overdue' | 'upcoming' | 'matched' | 'unmatched';
const LOCAL_EMAIL_BINDINGS_KEY = 'billing-email-bindings';

const DEFAULT_EMAIL_MESSAGE =
  'OlÃ¡, {nome}. Tudo bem?\n\n' +
  'AtravÃ©s deste e-mail, informamos o lembrete de vencimento do seu contrato de honorÃ¡rios junto ao escritÃ³rio Modaelli Advogados.\n\n' +
  'Refere-se Ã  parcela de abril no valor de R$ {valor}, com vencimento para o dia {vencimento}.\n\n' +
  'Para pagamento via PIX, segue nossa chave:\n' +
  'Modaelli Sociedade de Advogados\n' +
  'CNPJ: 48.697.725/0001-07\n\n' +
  'No momento da realizaÃ§Ã£o do PIX, aparecerÃ¡ o seguinte nome:\n' +
  'Grupo MMM ou Grupo M IntermediaÃ§Ãµes\n\n' +
  'Por gentileza, nos envie o comprovante para registrarmos a baixa no sistema.\n\n' +
  'Pedimos que desconsidere este e-mail caso o pagamento jÃ¡ tenha sido efetuado.\n\n' +
  'Estamos Ã  disposiÃ§Ã£o em caso de dÃºvidas.\n\n' +
  'Atenciosamente,\nEquipe Financeira\nModaelli Advogados';

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function parseDueDate(value: string) {
  const [day, month, year] = value.split('/');
  return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0);
}

function getMatchScore(client: Client, extractedName: string) {
  const clientName = normalizeText(client.name);
  const recordName = normalizeText(extractedName);

  if (!clientName || !recordName) {
    return 0;
  }

  if (clientName === recordName) {
    return 100;
  }

  if (clientName.startsWith(recordName) || recordName.startsWith(clientName)) {
    return 90;
  }

  if (clientName.includes(recordName) || recordName.includes(clientName)) {
    return 75;
  }

  const clientTokens = clientName.split(/\s+/).filter(Boolean);
  const recordTokens = recordName.split(/\s+/).filter(Boolean);
  const sharedTokens = recordTokens.filter((token) => clientTokens.includes(token)).length;

  if (sharedTokens === 0) {
    return 0;
  }

  return Math.round((sharedTokens / Math.max(clientTokens.length, recordTokens.length)) * 60);
}

function renderMessage(template: string, record: BillingRecord) {
  return template
    .replace(/\{nome\}/g, record.client_name)
    .replace(/\{valor\}/g, record.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 }))
    .replace(/\{vencimento\}/g, record.due_date);
}

function getUploadSummary(files: File[]) {
  return files.map((file) => file.name).join(', ');
}

function downloadExcelTemplate() {
  const rows = [
    ['Cliente', 'E-mail', 'Vencimento', 'Valor', 'ObservaÃ§Ã£o'],
    ['Nome do Cliente Exemplo', 'cliente@exemplo.com', '10/05/2026', 1500.0, 'Parcela de honorÃ¡rios'],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = [{ wch: 32 }, { wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 28 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'CobranÃ§as');
  XLSX.writeFile(workbook, 'modelo-cobrancas-modaelli.xlsx');
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function loadLocalEmailBindings() {
  if (typeof window === 'undefined') {
    return {} as Record<string, string>;
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_EMAIL_BINDINGS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveLocalEmailBindings(bindings: Record<string, string>) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(LOCAL_EMAIL_BINDINGS_KEY, JSON.stringify(bindings));
}

type SendBillingResponse = {
  sent: number;
  failed: number;
  results?: Array<{ email: string; success: boolean; error?: string }>;
};

function normalizeEmail(value?: string | null) {
  return (value || '').trim().toLowerCase();
}

function getSuccessfulEmails(response: SendBillingResponse) {
  return new Set(
    (response.results || [])
      .filter((result) => result.success)
      .map((result) => normalizeEmail(result.email))
      .filter(Boolean),
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Tente novamente em instantes.';
}

function isPermissionError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('row-level security') ||
    message.includes('permission denied') ||
    message.includes('not approved') ||
    message.includes('42501') ||
    message.includes('new row violates row-level security policy')
  );
}

function getFunctionErrorMessage(error: unknown) {
  const message = getErrorMessage(error);
  const lower = message.toLowerCase();

  if (lower.includes('functions_http_error') || lower.includes('edge function returned a non-2xx status code')) {
    return 'A funÃ§Ã£o de envio respondeu com erro. Verifique se a funÃ§Ã£o send-billing-email estÃ¡ publicada e com as variÃ¡veis RESEND_API_KEY e SUPABASE_SERVICE_ROLE_KEY configuradas.';
  }

  if (
    lower.includes('testing emails') ||
    lower.includes('verify a domain') ||
    lower.includes('domain is not verified') ||
    lower.includes('403') ||
    lower.includes('validation_error')
  ) {
    return 'O Resend bloqueou o envio porque o domÃ­nio/remetente ainda nÃ£o foi verificado. Depois de verificar o domÃ­nio da Modaelli, o envio para clientes externos fica liberado.';
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('fetch failed') ||
    lower.includes('functions_fetch_error') ||
    lower.includes('network')
  ) {
    return 'NÃ£o foi possÃ­vel alcanÃ§ar o serviÃ§o de envio. Confira a publicaÃ§Ã£o da funÃ§Ã£o send-billing-email no Supabase.';
  }

  if (lower.includes('not found') || lower.includes('404')) {
    return 'A funÃ§Ã£o send-billing-email nÃ£o foi encontrada no Supabase. Ela precisa estar publicada para o envio funcionar.';
  }

  return message;
}

async function sendBillingEmailRequest(records: BillingRecord[], messageTemplate: string) {
  const body = {
    records: records.map((record) => ({
      client_name: record.client_name,
      client_email: record.client_email,
      due_date: record.due_date,
      amount: record.amount,
    })),
    messageTemplate,
  };

  const invokeResult = await supabase.functions.invoke('send-billing-email', {
    body,
  });

  if (!invokeResult.error) {
    return invokeResult.data as SendBillingResponse;
  }

  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-billing-email`;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object'
        ? payload.error || payload.message || payload.details
        : null;

    throw new Error(
      typeof detail === 'string' && detail.trim()
        ? detail
        : getFunctionErrorMessage(invokeResult.error),
    );
  }

  return (payload || { sent: 0, failed: 0, results: [] }) as SendBillingResponse;
}

export default function Cobrancas() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [emailMessage, setEmailMessage] = useState(DEFAULT_EMAIL_MESSAGE);
  const [manualEmails, setManualEmails] = useState<Record<string, string>>({});
  const [bindingRecordId, setBindingRecordId] = useState<string | null>(null);
  const [localEmailBindings, setLocalEmailBindings] = useState<Record<string, string>>(() => loadLocalEmailBindings());

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name, email, phone');
      if (error) {
        throw error;
      }
      return (data || []) as Client[];
    },
  });

  const matchClients = useCallback(
    (extracted: ExtractedRecord[]) => {
      return extracted.map((record): BillingRecord => {
        const bindingKey = normalizeText(record.name);
        const bestMatch = clients
          .map((client) => ({ client, score: getMatchScore(client, record.name) }))
          .sort((a, b) => b.score - a.score)[0];

        const matchedClient = bestMatch && bestMatch.score >= 60 ? bestMatch.client : undefined;
        const dueDate = parseDueDate(record.dueDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isOverdue = dueDate < today;

        return {
          id: crypto.randomUUID(),
          client_name: record.name,
          due_date: record.dueDate,
          amount: record.amount,
          client_id: matchedClient?.id,
          client_email: record.email || matchedClient?.email || localEmailBindings[bindingKey],
          status:
            record.email || matchedClient || localEmailBindings[bindingKey]
              ? isOverdue
                ? 'overdue'
                : 'matched'
              : 'unmatched',
        };
      });
    },
    [clients, localEmailBindings],
  );

  const processFiles = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    const supportedFiles = files.filter((file) => {
      const fileName = file.name.toLowerCase();
      return (
        fileName.endsWith('.pdf') ||
        fileName.endsWith('.xls') ||
        fileName.endsWith('.xlsx') ||
        fileName.endsWith('.html') ||
        fileName.endsWith('.htm')
      );
    });

    if (supportedFiles.length === 0) {
      toast({
        title: 'Arquivo invÃ¡lido',
        description: 'Selecione um PDF, XLS/XLSX ou HTML exportado do contas a receber.',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    setUploadedFileName(getUploadSummary(supportedFiles));

    try {
      const extracted = await extractBillingRecords(supportedFiles);
      if (extracted.length === 0) {
        toast({
          title: 'Nenhum registro encontrado',
          description: 'NÃ£o foi possÃ­vel encontrar cliente, vencimento e valor nesses arquivos.',
          variant: 'destructive',
        });
        setRecords([]);
        setSelected(new Set());
        setManualEmails({});
        return;
      }

      const matched = matchClients(extracted);
      const autoSelected = new Set(
        matched.filter((record) => record.client_email && record.status !== 'sent').map((record) => record.id),
      );

      setRecords(matched);
      setSelected(autoSelected);
      setManualEmails({});

      const linkedCount = matched.filter((record) => !!record.client_email).length;
      const unmatchedCount = matched.length - linkedCount;

      toast({
        title: `${matched.length} registro(s) carregado(s)`,
        description:
          unmatchedCount > 0
            ? `${linkedCount} com e-mail vinculado e ${unmatchedCount} aguardando vÃ­nculo.`
            : 'Todos os registros foram vinculados automaticamente.',
      });
    } catch (error) {
      toast({
        title: 'Erro ao processar arquivo',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length > 0) {
      void processFiles(files);
    }
  };

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      void processFiles(files);
    }
    event.target.value = '';
  };

  const applyManualEmail = async (recordId: string) => {
    const record = records.find((item) => item.id === recordId);
    const email = (manualEmails[recordId] || '').trim().toLowerCase();

    if (!record) {
      return;
    }

    if (!isValidEmail(email)) {
      toast({
        title: 'E-mail invÃ¡lido',
        description: 'Digite um e-mail vÃ¡lido para vincular esta cobranÃ§a.',
        variant: 'destructive',
      });
      return;
    }

    setBindingRecordId(recordId);

    try {
      const bindingKey = normalizeText(record.client_name);
      const nextBindings = {
        ...localEmailBindings,
        [bindingKey]: email,
      };

      setLocalEmailBindings(nextBindings);
      saveLocalEmailBindings(nextBindings);

      setRecords((previous) =>
        previous.map((item) => {
          if (item.id !== recordId) {
            return item;
          }

          return {
            ...item,
            client_email: email,
            status: item.status === 'overdue' ? 'overdue' : 'matched',
          };
        }),
      );

      setSelected((previous) => new Set(previous).add(recordId));
      setManualEmails((previous) => ({
        ...previous,
        [recordId]: email,
      }));

      const bestMatch =
        record.client_id
          ? clients.find((client) => client.id === record.client_id)
          : clients
              .map((client) => ({ client, score: getMatchScore(client, record.client_name) }))
              .sort((a, b) => b.score - a.score)[0]?.client;

      let clientId = record.client_id || bestMatch?.id;
      let createdClient = false;

      let persistedToDatabase = false;

      if (clientId) {
        const { error } = await supabase.from('clients').update({ email }).eq('id', clientId);

        if (error) {
          if (!isPermissionError(error)) {
            throw error;
          }
        } else {
          persistedToDatabase = true;
        }
      } else {
        const { data, error } = await supabase
          .from('clients')
          .insert({
            name: record.client_name,
            email,
            phone: null,
          })
          .select('id')
          .maybeSingle();

        if (error) {
          if (!isPermissionError(error)) {
            throw error;
          }
        } else {
          if (!data?.id) {
            throw new Error('NÃ£o foi possÃ­vel identificar o cliente criado.');
          }

          clientId = data.id;
          createdClient = true;
          persistedToDatabase = true;
        }
      }

      setRecords((previous) =>
        previous.map((item) => {
          if (item.id !== recordId) {
            return item;
          }

          return {
            ...item,
            client_id: clientId,
            client_email: email,
            status: item.status === 'overdue' ? 'overdue' : 'matched',
          };
        }),
      );

      if (persistedToDatabase) {
        await queryClient.invalidateQueries({ queryKey: ['clients-all'] });
        await queryClient.invalidateQueries({ queryKey: ['clients'] });
      }

      toast({
        title: persistedToDatabase
          ? createdClient
            ? 'Cliente criado e vinculado'
            : 'Cliente atualizado e vinculado'
          : 'E-mail vinculado na cobranÃ§a',
        description: persistedToDatabase
          ? createdClient
            ? `${email} foi salvo em Clientes e vinculado a esta cobranÃ§a.`
            : `${email} foi salvo no cadastro do cliente e vinculado a esta cobranÃ§a.`
          : `${email} ficou vinculado nesta cobranÃ§a e salvo localmente para os prÃ³ximos envios.`,
      });
    } catch (error) {
      toast({
        title: 'NÃ£o foi possÃ­vel vincular o e-mail',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setBindingRecordId(null);
    }
  };

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      if (filter === 'overdue') {
        return record.status === 'overdue';
      }

      if (filter === 'matched') {
        return record.status === 'matched' || record.status === 'overdue' || record.status === 'sent';
      }

      if (filter === 'unmatched') {
        return record.status === 'unmatched';
      }

      if (filter === 'upcoming') {
        const diff = (parseDueDate(record.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        return diff >= 0 && diff <= 7;
      }

      return true;
    });
  }, [filter, records]);

  const selectableFilteredIds = filteredRecords
    .filter((record) => record.client_email && record.status !== 'sent')
    .map((record) => record.id);

  const selectedFilteredCount = selectableFilteredIds.filter((id) => selected.has(id)).length;

  const filterCounts: Record<Filter, number> = {
    all: records.length,
    overdue: records.filter((record) => record.status === 'overdue').length,
    upcoming: records.filter((record) => {
      const diff = (parseDueDate(record.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff <= 7;
    }).length,
    matched: records.filter(
      (record) => record.status === 'matched' || record.status === 'overdue' || record.status === 'sent',
    ).length,
    unmatched: records.filter((record) => record.status === 'unmatched').length,
  };

  const summary = {
    total: records.length,
    linked: records.filter((record) => !!record.client_email).length,
    overdue: records.filter((record) => record.status === 'overdue').length,
    selectedAmount: records.filter((record) => selected.has(record.id)).reduce((sum, record) => sum + record.amount, 0),
  };

  const totalAmount = filteredRecords.reduce((sum, record) => sum + record.amount, 0);
  const selectedRecords = records.filter(
    (record) => selected.has(record.id) && record.client_email && record.status !== 'sent',
  );

  const previewRecord =
    selectedRecords[0] ||
    filteredRecords.find((record) => !!record.client_email) ||
    records.find((record) => !!record.client_email);
  const emailPreview = previewRecord ? renderMessage(emailMessage, previewRecord) : null;

  const toggleSelect = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelected((previous) => {
      const next = new Set(previous);
      const allSelected = selectableFilteredIds.length > 0 && selectableFilteredIds.every((id) => previous.has(id));

      if (allSelected) {
        selectableFilteredIds.forEach((id) => next.delete(id));
      } else {
        selectableFilteredIds.forEach((id) => next.add(id));
      }

      return next;
    });
  };

  const sendMutation = useMutation({
    mutationFn: async (recordsToSend: BillingRecord[]) => {
      const seenEmails = new Set<string>();
      const uniqueRecords = recordsToSend.filter((record) => {
        const email = normalizeEmail(record.client_email);

        if (!email || !isValidEmail(email) || seenEmails.has(email)) {
          return false;
        }

        seenEmails.add(email);
        return true;
      });

      if (uniqueRecords.length === 0) {
        throw new Error('Nenhuma cobranÃ§a selecionada possui e-mail vÃ¡lido para envio.');
      }

      const result = await sendBillingEmailRequest(uniqueRecords, emailMessage);

      if (result.failed > 0 && result.sent === 0) {
        const firstError = result.results?.find((resultItem) => !resultItem.success && resultItem.error)?.error;
        throw new Error(firstError || 'Nenhuma cobranÃ§a foi enviada.');
      }

      return result;
    },
    onSuccess: (data) => {
      const message =
        data.failed > 0
          ? `${data.sent} envio(s) concluÃ­dos e ${data.failed} falha(s).`
          : `${data.sent} cobranÃ§a(s) enviada(s) com sucesso!`;

      const firstError = data.results?.find((result) => !result.success && result.error)?.error;

      toast({
        title: message,
        description: data.failed > 0 ? firstError || 'Alguns registros nÃ£o puderam ser enviados.' : undefined,
      });

      const successfulEmails = getSuccessfulEmails(data);

      setRecords((previous) =>
        previous.map((record) => {
          const email = normalizeEmail(record.client_email);
          return selected.has(record.id) && successfulEmails.has(email) ? { ...record, status: 'sent' as const } : record;
        }),
      );
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['recent-emails'] });
      queryClient.invalidateQueries({ queryKey: ['email-count'] });
      queryClient.invalidateQueries({ queryKey: ['email-logs'] });
      queryClient.invalidateQueries({ queryKey: ['billing-stats'] });
    },
    onError: (error) => {
      toast({
        title: 'Erro ao enviar cobranÃ§as',
        description: getFunctionErrorMessage(error),
        variant: 'destructive',
      });
    },
  });

  const handleSend = () => {
    if (selectedRecords.length === 0) {
      toast({ title: 'Selecione registros com e-mail vinculado', variant: 'destructive' });
      return;
    }

    sendMutation.mutate(selectedRecords);
  };

  const summaryCards = [
    {
      title: 'Registros lidos',
      value: summary.total,
      subtitle: 'Linhas extraÃ­das do arquivo importado.',
      icon: FileText,
    },
    {
      title: 'Com e-mail',
      value: summary.linked,
      subtitle: 'Prontas para comunicaÃ§Ã£o automÃ¡tica.',
      icon: Link2,
    },
    {
      title: 'Em atraso',
      value: summary.overdue,
      subtitle: 'Demandam prioridade no contato.',
      icon: Clock3,
    },
    {
      title: 'Valor selecionado',
      value: `R$ ${summary.selectedAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      subtitle: 'Base usada no prÃ³ximo disparo.',
      icon: Send,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-[linear-gradient(135deg,rgba(18,31,49,0.96),rgba(28,46,73,0.88))] text-white shadow-[0_26px_80px_rgba(15,23,42,0.18)]">
        <div className="grid gap-8 px-6 py-7 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-300">OperaÃ§Ã£o de cobranÃ§as</p>
            <div className="space-y-3">
              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Leitura, vinculaÃ§Ã£o e envio com a mesma sobriedade da marca Modaelli.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                Importe arquivos do contas a receber, revise correspondÃªncias, ajuste casos sem vÃ­nculo e dispare a
                comunicaÃ§Ã£o em um fluxo pensado para a rotina do escritÃ³rio.
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-[1.4rem] border border-white/10 bg-white/5 p-4 backdrop-blur sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Janela operacional</p>
              <p className="mt-3 text-3xl font-semibold text-white">{summary.total}</p>
              <p className="mt-2 text-sm text-slate-300">
                registros em anÃ¡lise nesta tela, com filtros e revisÃ£o antes do disparo.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Vinculados</p>
              <p className="mt-3 text-3xl font-semibold text-white">{summary.linked}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Selecionados</p>
              <p className="mt-3 text-3xl font-semibold text-white">{selectedRecords.length}</p>
            </div>
          </div>
        </div>
      </section>

      <Tabs defaultValue="importadas" className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Central de CobranÃ§as</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Trabalhe cobranÃ§as importadas e manuais no mesmo lugar.
            </p>
          </div>
          <TabsList className="h-auto rounded-2xl bg-muted/60 p-1">
            <TabsTrigger value="importadas" className="rounded-xl px-4 py-2">
              Importadas
            </TabsTrigger>
            <TabsTrigger value="manuais" className="rounded-xl px-4 py-2">
              Manuais
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="importadas" className="space-y-6">

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
        <CardContent className="p-6">
          <label
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[1.6rem] border-2 border-dashed px-6 py-14 text-center transition-colors ${
              dragOver ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'
            }`}
          >
            <input type="file" accept=".pdf,.xls,.xlsx,.html,.htm" multiple className="hidden" onChange={handleFileInput} />
            {uploading ? (
              <div className="text-sm text-muted-foreground">Processando arquivo...</div>
            ) : (
              <>
                <div className="rounded-2xl bg-primary/10 p-4 text-primary">
                  <Upload className="h-8 w-8" />
                </div>
                <div className="space-y-2">
                  <p className="text-base font-medium">Envie o PDF ou a planilha Excel da cobranÃ§a</p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    A leitura aceita <span className="font-medium">.xls</span>, <span className="font-medium">.xlsx</span>, PDF e HTML exportado.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={(event) => {
                      event.preventDefault();
                      downloadExcelTemplate();
                    }}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Baixar modelo Excel
                  </Button>
                  {uploadedFileName ? (
                    <p className="text-xs font-medium text-foreground">Ãšltimo upload: {uploadedFileName}</p>
                  ) : null}
                </div>
              </>
            )}
          </label>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageSquare className="h-5 w-5 text-accent" />
              Mensagem institucional do e-mail
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Use {'{nome}'}, {'{valor}'} e {'{vencimento}'} para preencher automaticamente.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={emailMessage}
              onChange={(event) => setEmailMessage(event.target.value)}
              rows={9}
              placeholder="Escreva a mensagem do e-mail de cobranÃ§a..."
              className="rounded-2xl border-border/70 bg-background/80"
            />
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
          <CardHeader>
            <CardTitle className="text-lg">PrÃ©-visualizaÃ§Ã£o</CardTitle>
          </CardHeader>
          <CardContent>
            {emailPreview ? (
              <div className="rounded-[1.4rem] border border-border/70 bg-background/80 p-5">
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Texto renderizado
                </p>
                <p className="whitespace-pre-line text-sm leading-7">{emailPreview}</p>
              </div>
            ) : (
              <div className="rounded-[1.4rem] border border-dashed border-border/70 p-5 text-sm leading-6 text-muted-foreground">
              Carregue um arquivo com clientes vinculados para ver a prÃ©-visualizaÃ§Ã£o do e-mail.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {records.length > 0 ? (
        <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
          <CardHeader className="gap-4 border-b border-border/60 pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-lg">RevisÃ£o dos registros</CardTitle>
              <p className="text-sm text-muted-foreground">
                Aplique filtros, complete e-mails ausentes e selecione apenas o que deve seguir para envio.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {([
                ['all', 'Todos'],
                ['overdue', 'Vencidos'],
                ['upcoming', 'PrÃ³ximos 7 dias'],
                ['matched', 'Com e-mail'],
                ['unmatched', 'Sem e-mail'],
              ] as [Filter, string][]).map(([key, label]) => (
                <Button
                  key={key}
                  variant={filter === key ? 'default' : 'outline'}
                  size="sm"
                  className="rounded-xl"
                  onClick={() => setFilter(key)}
                >
                  {label} ({filterCounts[key]})
                </Button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="space-y-4 p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                <p className="text-sm font-medium">Registros visÃ­veis</p>
                <p className="mt-2 text-2xl font-semibold">{filteredRecords.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">Total exibido no filtro atual.</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                <p className="text-sm font-medium">Prontos para envio</p>
                <p className="mt-2 text-2xl font-semibold">{selectedRecords.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">Selecionados com e-mail vÃ¡lido.</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                <p className="text-sm font-medium">Valor filtrado</p>
                <p className="mt-2 text-2xl font-semibold">
                  R$ {totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Escopo financeiro em anÃ¡lise.</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="text-sm text-muted-foreground">
                {filteredRecords.length} registro(s) visÃ­veis, {selectedRecords.length} pronto(s) para envio.
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={selectAll}
                  disabled={selectableFilteredIds.length === 0}
                >
                  {selectedFilteredCount === selectableFilteredIds.length && selectableFilteredIds.length > 0
                    ? 'Limpar seleÃ§Ã£o'
                    : 'Selecionar visÃ­veis'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => downloadCSV(filteredRecords)}
                >
                  <Download className="mr-2 h-4 w-4" />
                  CSV
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => {
                    copyToClipboard(filteredRecords);
                    toast({ title: 'Tabela copiada' });
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copiar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="rounded-xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(216_48%_34%))]"
                  onClick={handleSend}
                  disabled={selectedRecords.length === 0 || sendMutation.isPending}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {sendMutation.isPending ? 'Enviando...' : `Enviar (${selectedRecords.length})`}
                </Button>
              </div>
            </div>

            <div className="overflow-hidden rounded-[1.35rem] border border-border/70">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectableFilteredIds.length > 0 && selectableFilteredIds.every((id) => selected.has(id))}
                        onCheckedChange={selectAll}
                      />
                    </TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>E-mail / VÃ­nculo</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecords.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        Nenhum registro encontrado para esse filtro.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRecords.map((record) => (
                      <TableRow key={record.id} className="bg-background/70">
                        <TableCell>
                          <Checkbox
                            checked={selected.has(record.id)}
                            onCheckedChange={() => toggleSelect(record.id)}
                            disabled={record.status === 'sent' || !record.client_email}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{record.client_name}</TableCell>
                        <TableCell>{record.due_date}</TableCell>
                        <TableCell>R$ {record.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="space-y-2">
                          {record.client_email ? (
                            <span className="flex items-center gap-1 text-sm">
                              <CheckCircle2 className="h-3 w-3 text-green-500" />
                              {record.client_email}
                            </span>
                          ) : (
                            <>
                              <span className="flex items-center gap-1 text-sm text-destructive">
                                <AlertCircle className="h-3 w-3" />
                                NÃ£o vinculado
                              </span>
                              <div className="flex min-w-[260px] gap-2">
                                <Input
                                  type="email"
                                  placeholder="Digite o e-mail"
                                  value={manualEmails[record.id] || ''}
                                  onChange={(event) =>
                                    setManualEmails((previous) => ({
                                      ...previous,
                                      [record.id]: event.target.value,
                                    }))
                                  }
                                  className="h-9 rounded-xl border-border/70 bg-background/80"
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="rounded-xl"
                                  onClick={() => applyManualEmail(record.id)}
                                  disabled={bindingRecordId === record.id}
                                >
                                  {bindingRecordId === record.id ? 'Salvando...' : 'Vincular'}
                                </Button>
                              </div>
                            </>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              record.status === 'sent'
                                ? 'default'
                                : record.status === 'overdue'
                                  ? 'destructive'
                                  : record.status === 'matched'
                                    ? 'secondary'
                                    : 'outline'
                            }
                          >
                            {record.status === 'sent'
                              ? 'Enviado'
                              : record.status === 'overdue'
                                ? 'Vencido'
                                : record.status === 'matched'
                                  ? 'Vinculado'
                                  : 'Sem vÃ­nculo'}
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
      ) : null}

        </TabsContent>

        <TabsContent value="manuais">
          <Pagamentos />
        </TabsContent>
      </Tabs>
    </div>
  );
}
