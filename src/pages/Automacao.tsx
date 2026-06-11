import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Play,
  RefreshCw,
  Trello,
  Upload,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { extractBillingRecords, type ExtractedRecord } from '@/lib/pdf-extractor';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';

type AutomationPreviewRow = {
  rowNumber: number | null;
  clientName: string;
  action: string;
  status: string;
  sources: string[];
  errorMessage: string;
  cardUrl: string;
};

type AutomationResult = {
  dryRun: boolean;
  sheetName: string;
  startRow: number;
  processed: number;
  skipped: number;
  matched: number;
  updated: number;
  refreshed: number;
  ignored: number;
  notFound: number;
  errors: number;
  updatedCells: number;
  logRows: number;
  preview: AutomationPreviewRow[];
  pendingCount: number;
  pendingSelections: PendingProcessSelection[];
};

type ProcessOption = {
  selectionId: string;
  rowNumber: number;
  clientName: string;
  code: string;
  serviceCode: string;
  process: string;
  matter: string;
  amount: number | null;
  dueDay: string;
  financialStatus: string;
  contractDate: string;
};

type PendingProcessSelection = {
  recordKey: string;
  clientName: string;
  pdfDueDate: string;
  pdfAmount: number | null;
  pdfDescription: string;
  suggestedSelectionId: string;
  options: ProcessOption[];
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: unknown;
      error?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };

    const pieces = [
      typeof candidate.message === 'string' ? candidate.message : null,
      typeof candidate.error === 'string' ? candidate.error : null,
      typeof candidate.details === 'string' ? candidate.details : null,
      typeof candidate.hint === 'string' ? candidate.hint : null,
      typeof candidate.code === 'string' ? `Código: ${candidate.code}` : null,
    ].filter(Boolean);

    if (pieces.length > 0) return pieces.join(' | ');
  }

  return 'Tente novamente.';
}

function getFunctionErrorMessage(error: unknown) {
  const message = getErrorMessage(error);
  const lower = message.toLowerCase();

  if (lower.includes('functions_http_error') || lower.includes('edge function returned a non-2xx status code')) {
    return 'A automação respondeu com erro no Supabase. Confira o Excel enviado, a aba da planilha e as integrações.';
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('fetch failed') ||
    lower.includes('functions_fetch_error') ||
    lower.includes('network')
  ) {
    return 'Não foi possível alcançar a função de automação no Supabase.';
  }

  if (lower.includes('not found') || lower.includes('404')) {
    return 'A função run-finance-automation não foi encontrada no Supabase.';
  }

  return message;
}

async function runAutomationRequest(payload: {
  dryRun: boolean;
  maxRows?: number;
  startRow?: number;
  sheetName?: string;
  pdfFileName?: string;
  pdfRecords: ExtractedRecord[];
  selectedProcessMatches?: Record<string, string>;
}) {
  const invokeResult = await supabase.functions.invoke<AutomationResult>('run-finance-automation', {
    body: payload,
  });

  if (!invokeResult.error) {
    if (!invokeResult.data) {
      throw new Error('A automação não retornou dados.');
    }

    return invokeResult.data;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-finance-automation`;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: publishableKey,
      Authorization: `Bearer ${session?.access_token || publishableKey}`,
    },
    body: JSON.stringify(payload),
  });

  const detailPayload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      detailPayload && typeof detailPayload === 'object'
        ? detailPayload.error || detailPayload.message || detailPayload.details
        : null;

    throw new Error(
      typeof detail === 'string' && detail.trim()
        ? detail
        : getFunctionErrorMessage(invokeResult.error),
    );
  }

  if (!detailPayload) {
    throw new Error('A automação não retornou dados.');
  }

  return detailPayload as AutomationResult;
}

function formatActionLabel(action: string) {
  switch (action) {
    case 'atualizado':
      return 'Atualizado';
    case 'cliente_adicionado':
      return 'Cliente adicionado';
    case 'data_atualizada':
      return 'Data atualizada';
    case 'nao_encontrado':
      return 'Não encontrado';
    case 'dry_run':
      return 'Prévia';
    case 'erro_global':
      return 'Erro global';
    default:
      return action.replaceAll('_', ' ');
  }
}

export default function Automacao() {
  const { toast } = useToast();
  const [dryRun, setDryRun] = useState(true);
  const [maxRows, setMaxRows] = useState('');
  const [startRow, setStartRow] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [pdfFileName, setPdfFileName] = useState('');
  const [pdfRecords, setPdfRecords] = useState<ExtractedRecord[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [lastResult, setLastResult] = useState<AutomationResult | null>(null);
  const [pendingSelections, setPendingSelections] = useState<PendingProcessSelection[]>([]);
  const [processSelectionDialogOpen, setProcessSelectionDialogOpen] = useState(false);
  const [selectedProcessMatches, setSelectedProcessMatches] = useState<Record<string, string>>({});

  const handlePdfSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setPdfLoading(true);
    setPdfFileName(file.name);

    try {
      const records = await extractBillingRecords(file);
      setPdfRecords(records);
      toast({
        title: 'Excel processado',
        description: `${records.length} registro(s) extraído(s) do Excel.`,
      });
    } catch (error) {
      setPdfRecords([]);
      toast({
        title: 'Não foi possível ler o Excel',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setPdfLoading(false);
      event.target.value = '';
    }
  };

  const automationMutation = useMutation({
    mutationFn: async (selectedMatches: Record<string, string> = {}) => {
      if (pdfRecords.length === 0) {
        throw new Error('Selecione um Excel válido antes de executar a automação.');
      }

      const payload = {
        dryRun,
        maxRows: maxRows.trim() ? Number(maxRows) : undefined,
        startRow: startRow.trim() ? Number(startRow) : undefined,
        sheetName: sheetName.trim() || undefined,
        pdfFileName: pdfFileName || undefined,
        pdfRecords,
        selectedProcessMatches: selectedMatches,
      };

      return runAutomationRequest(payload);
    },
    onSuccess: (data) => {
      setLastResult(data);
      if (data.pendingSelections.length > 0) {
        const suggestedMatches = Object.fromEntries(
          data.pendingSelections
            .filter((selection) => selection.suggestedSelectionId)
            .map((selection) => [selection.recordKey, selection.suggestedSelectionId]),
        );

        setPendingSelections(data.pendingSelections);
        setSelectedProcessMatches(suggestedMatches);
        setProcessSelectionDialogOpen(true);
        toast({
        title: 'Escolha o processo correto',
        description: `${data.pendingSelections.length} cliente(s) precisam de confirmação antes do preenchimento.`,
        });
        return;
      }

      setPendingSelections([]);
      setProcessSelectionDialogOpen(false);
      toast({
        title: data.dryRun ? 'Teste concluído' : 'Planilha atualizada',
        description: `${data.matched} cliente(s) com match no Excel, ${data.updated + data.refreshed} linha(s) tratada(s).`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Não foi possível executar a automação',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    },
  });

  const allPendingSelectionsFilled = useMemo(
    () => pendingSelections.every((selection) => Boolean(selectedProcessMatches[selection.recordKey])),
    [pendingSelections, selectedProcessMatches],
  );

  const summaryCards = [
    {
      title: 'Linhas lidas',
      value: lastResult?.processed ?? '-',
      subtitle: lastResult ? `${lastResult.skipped} linha(s) ignorada(s)` : 'Busca completa por padrão',
      icon: FileSpreadsheet,
    },
    {
      title: 'Clientes com match',
      value: lastResult?.matched ?? '-',
      subtitle: 'Correspondência entre Excel e coluna I',
      icon: FileText,
    },
    {
      title: 'Não encontrados',
      value: lastResult?.notFound ?? '-',
      subtitle: lastResult?.pendingCount ? `${lastResult.pendingCount} aguardando seleção` : 'Clientes do Excel sem linha correspondente',
      icon: AlertTriangle,
    },
    {
      title: 'Atualizações',
      value: lastResult ? lastResult.updated + lastResult.refreshed : '-',
      subtitle: lastResult ? `${lastResult.logRows} log(s) gravado(s)` : 'Sem execução ainda',
      icon: CheckCircle2,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-[linear-gradient(135deg,rgba(18,31,49,0.96),rgba(28,46,73,0.88))] text-white shadow-[0_26px_80px_rgba(15,23,42,0.18)]">
        <div className="grid gap-8 px-6 py-7 lg:grid-cols-[1.12fr_0.88fr] lg:px-8">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-300">Automação Excel + Integra + Trello</p>
            <div className="space-y-3">
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Atualize e complete a planilha a partir do nome da coluna I.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                A execução cruza o Excel enviado com a planilha, consulta Integra e Trello quando disponíveis, compara os dados
                atuais e registra tudo na aba LOG_AUTOMACAO.
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-[1.4rem] border border-white/10 bg-white/5 p-4 backdrop-blur sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Modo</p>
              <p className="mt-3 text-2xl font-semibold text-white">{dryRun ? 'Teste' : 'Execução'}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Arquivo</p>
              <p className="mt-3 text-sm font-semibold text-white">{pdfFileName || 'Nenhum arquivo enviado'}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Segurança</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                A automação atualiza clientes existentes e também cria novas linhas quando o cliente vier no Excel e ainda não existir na planilha.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[0.82fr_1.18fr]">
        <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bot className="h-5 w-5 text-accent" />
              Executar automação
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            <div className="space-y-3 rounded-2xl border border-border/70 bg-background/80 p-4">
              <div className="space-y-1">
                <Label htmlFor="pdf-upload">Excel do Integra</Label>
                <p className="text-xs leading-5 text-muted-foreground">
                  Envie o Excel exportado antes da execução. Ele será usado para fazer o match pelo nome.
                </p>
              </div>
              <label
                htmlFor="pdf-upload"
                className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-border/70 px-4 py-3 text-sm transition-colors hover:border-accent/50"
              >
                <span className="truncate text-muted-foreground">
                  {pdfLoading
                    ? 'Lendo Excel...'
                    : pdfFileName
                      ? `${pdfFileName} (${pdfRecords.length} registro(s))`
                      : 'Selecionar arquivo .xls ou .xlsx'}
                </span>
                <span className="rounded-lg bg-primary/10 p-2 text-primary">
                  <Upload className="h-4 w-4" />
                </span>
              </label>
              <input id="pdf-upload" type="file" accept=".xls,.xlsx" className="hidden" onChange={handlePdfSelection} />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-background/80 p-4">
              <div className="space-y-1">
                <Label htmlFor="dry-run">Modo teste</Label>
                <p className="text-xs leading-5 text-muted-foreground">
                  Não grava na aba principal, mas mantém o relatório da execução na LOG_AUTOMACAO.
                </p>
              </div>
              <Switch id="dry-run" checked={dryRun} onCheckedChange={setDryRun} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sheet-name">Aba da planilha</Label>
              <Input
                id="sheet-name"
                value={sheetName}
                onChange={(event) => setSheetName(event.target.value)}
                placeholder="Ex.: Operação Atlas (PRD)"
                className="h-11 rounded-xl border-border/70 bg-background/80"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-rows">Limite de linhas (opcional)</Label>
              <Input
                id="max-rows"
                value={maxRows}
                onChange={(event) => setMaxRows(event.target.value)}
                inputMode="numeric"
                placeholder="Deixe em branco para buscar a aba inteira"
                className="h-11 rounded-xl border-border/70 bg-background/80"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Se ficar vazio, a automação procura em toda a aba por conta própria.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="start-row">Começar na linha (opcional)</Label>
              <Input
                id="start-row"
                value={startRow}
                onChange={(event) => setStartRow(event.target.value)}
                inputMode="numeric"
                placeholder="Deixe em branco para começar do topo"
                className="h-11 rounded-xl border-border/70 bg-background/80"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Use esse campo só se quiser restringir a busca. Em branco, a leitura começa no topo da coluna I.
              </p>
            </div>

            <Button
              type="button"
              className="h-11 w-full rounded-xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(216_48%_34%))]"
              disabled={automationMutation.isPending || pdfLoading}
              onClick={() => automationMutation.mutate({})}
            >
              {automationMutation.isPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Executando...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  {dryRun ? 'Testar automação' : 'Atualizar planilha'}
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <div className="grid auto-rows-min gap-4 md:grid-cols-2">
          {summaryCards.map((card) => (
            <Card key={card.title} className="min-h-[132px] border-border/70 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
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
      </div>

      <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">Prévia da última execução</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Mostra todas as linhas registradas nesta execução para conferência rápida.
              </p>
            </div>
            {lastResult ? (
              <Badge variant={lastResult.dryRun ? 'secondary' : 'default'} className="h-9 rounded-xl px-3">
                {lastResult.dryRun ? 'Teste com log' : `Aba ${lastResult.sheetName}`}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <div className="overflow-hidden rounded-[1.35rem] border border-border/70">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Linha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Fontes</TableHead>
                  <TableHead>Erro</TableHead>
                  <TableHead>Card</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!lastResult ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      Execute a automação para visualizar o resumo do LOG_AUTOMACAO.
                    </TableCell>
                  </TableRow>
                ) : lastResult.preview.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      Nenhuma linha foi registrada nesta execução.
                    </TableCell>
                  </TableRow>
                ) : (
                  lastResult.preview.map((row, index) => (
                    <TableRow key={`${row.rowNumber ?? 'sem-linha'}-${row.clientName}-${index}`} className="bg-background/70 align-top">
                      <TableCell>{row.rowNumber ?? '-'}</TableCell>
                      <TableCell className="min-w-[180px] font-medium">{row.clientName}</TableCell>
                      <TableCell>{formatActionLabel(row.action)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.status || '-'}</Badge>
                      </TableCell>
                      <TableCell className="min-w-[160px]">{row.sources.length > 0 ? row.sources.join(', ') : '-'}</TableCell>
                      <TableCell className="min-w-[260px] text-xs leading-5 text-muted-foreground">
                        {row.errorMessage || '-'}
                      </TableCell>
                      <TableCell>
                        {row.cardUrl ? (
                          <a
                            href={row.cardUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                          >
                            Abrir
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          '-'
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

      <Dialog open={processSelectionDialogOpen} onOpenChange={setProcessSelectionDialogOpen}>
        <DialogContent className="max-w-4xl border-border/70 bg-card/95 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
          <DialogHeader>
            <DialogTitle>Escolha o processo correto</DialogTitle>
            <DialogDescription>
              Quando houver mais de um processo para o mesmo cliente, selecione a opção correta para concluir o preenchimento.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-6">
              {pendingSelections.map((selection) => (
                <div key={selection.recordKey} className="space-y-3 rounded-2xl border border-border/70 p-4">
                  <div className="space-y-1">
                    <p className="text-base font-semibold">{selection.clientName}</p>
                    <p className="text-xs text-muted-foreground">
                      Excel: {selection.pdfDescription || 'Sem descrição'}
                      {selection.pdfAmount !== null
                        ? ` | Parcela: ${selection.pdfAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
                        : ''}
                      {selection.pdfDueDate ? ` | Vencimento: ${selection.pdfDueDate}` : ''}
                    </p>
                  </div>

                  <RadioGroup
                    value={selectedProcessMatches[selection.recordKey] || ''}
                    onValueChange={(value) =>
                      setSelectedProcessMatches((current) => ({
                        ...current,
                        [selection.recordKey]: value,
                      }))
                    }
                    className="space-y-3"
                  >
                    {selection.options.map((option) => (
                      <label
                        key={option.selectionId}
                        className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 p-3 transition-colors hover:border-primary/50"
                      >
                        <RadioGroupItem value={option.selectionId} className="mt-1" />
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{option.code || 'Sem COD-CL'}</Badge>
                            {option.serviceCode ? <Badge variant="secondary">{option.serviceCode}</Badge> : null}
                            {selection.suggestedSelectionId === option.selectionId ? <Badge>Sugestão</Badge> : null}
                          </div>
                          <p className="text-sm font-medium">{option.process || 'Processo não informado'}</p>
                          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                            <span>Matéria: {option.matter || '-'}</span>
                            <span>
                              Valor:{' '}
                              {option.amount !== null
                                ? option.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                                : '-'}
                            </span>
                            <span>Venc.: {option.dueDay || '-'}</span>
                            <span>Financeiro: {option.financialStatus || '-'}</span>
                          </div>
                        </div>
                      </label>
                    ))}
                  </RadioGroup>
                </div>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setProcessSelectionDialogOpen(false)}>
              Revisar depois
            </Button>
            <Button
              type="button"
              disabled={!allPendingSelectionsFilled || automationMutation.isPending}
              onClick={() => automationMutation.mutate(selectedProcessMatches)}
            >
              Confirmar e preencher
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
