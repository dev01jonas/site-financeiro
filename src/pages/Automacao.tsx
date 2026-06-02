import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  Play,
  RefreshCw,
  Trello,
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

type AutomationPreviewRow = {
  rowNumber: number;
  clientName: string;
  resultLabel: string;
  situation: string;
  actionDate: string;
  cardUrl: string;
  status: string;
};

type AutomationResult = {
  dryRun: boolean;
  sheetName: string;
  processed: number;
  skipped: number;
  found: number;
  notFound: number;
  errors: number;
  updatedCells: number;
  logRows: number;
  preview: AutomationPreviewRow[];
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Tente novamente.';
}

export default function Automacao() {
  const { toast } = useToast();
  const [dryRun, setDryRun] = useState(true);
  const [maxRows, setMaxRows] = useState('25');
  const [startRow, setStartRow] = useState('2');
  const [sheetName, setSheetName] = useState('');
  const [lastResult, setLastResult] = useState<AutomationResult | null>(null);

  const automationMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        dryRun,
        maxRows: maxRows.trim() ? Number(maxRows) : undefined,
        startRow: startRow.trim() ? Number(startRow) : undefined,
        sheetName: sheetName.trim() || undefined,
      };

      const { data, error } = await supabase.functions.invoke<AutomationResult>('run-finance-automation', {
        body: payload,
      });

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error('A automação não retornou dados.');
      }

      return data;
    },
    onSuccess: (data) => {
      setLastResult(data);
      toast({
        title: data.dryRun ? 'Teste concluído' : 'Planilha atualizada',
        description: `${data.processed} linha(s) processada(s), ${data.found} card(s) localizado(s).`,
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

  const summaryCards = [
    {
      title: 'Linhas processadas',
      value: lastResult?.processed ?? '-',
      subtitle: lastResult ? `${lastResult.skipped} linha(s) ignorada(s)` : 'Aguardando execução',
      icon: FileSpreadsheet,
    },
    {
      title: 'Cards localizados',
      value: lastResult?.found ?? '-',
      subtitle: 'Busca feita pelo nome do cliente',
      icon: Trello,
    },
    {
      title: 'Não localizados',
      value: lastResult?.notFound ?? '-',
      subtitle: 'Linhas sem correspondência no Trello',
      icon: AlertTriangle,
    },
    {
      title: 'Atualizações',
      value: lastResult?.updatedCells ?? '-',
      subtitle: lastResult?.dryRun ? 'Modo teste não grava alterações' : `${lastResult?.logRows ?? 0} log(s) gravado(s)`,
      icon: CheckCircle2,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-[linear-gradient(135deg,rgba(18,31,49,0.96),rgba(28,46,73,0.88))] text-white shadow-[0_26px_80px_rgba(15,23,42,0.18)]">
        <div className="grid gap-8 px-6 py-7 lg:grid-cols-[1.12fr_0.88fr] lg:px-8">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-300">Automação Trello + Sheets</p>
            <div className="space-y-3">
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Atualize a planilha financeira com a situação dos cartões no Trello.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                A execução roda pelo Supabase, lê a aba configurada do Google Sheets, procura os clientes no Trello e grava
                resultado, situação, data da ação e log de automação.
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-[1.4rem] border border-white/10 bg-white/5 p-4 backdrop-blur sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Modo</p>
              <p className="mt-3 text-2xl font-semibold text-white">{dryRun ? 'Teste' : 'Execução'}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Último resultado</p>
              <p className="mt-3 text-2xl font-semibold text-white">{lastResult ? `${lastResult.found}/${lastResult.processed}` : '-'}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Segurança</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                As chaves do Trello e do Google ficam somente nas variáveis da função Supabase.
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
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-background/80 p-4">
              <div className="space-y-1">
                <Label htmlFor="dry-run">Modo teste</Label>
                <p className="text-xs leading-5 text-muted-foreground">
                  Busca no Trello e mostra prévia sem gravar na planilha.
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
                placeholder="Usar padrão configurado, ex: Externos"
                className="h-11 rounded-xl border-border/70 bg-background/80"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-rows">Limite de linhas</Label>
              <Input
                id="max-rows"
                value={maxRows}
                onChange={(event) => setMaxRows(event.target.value)}
                inputMode="numeric"
                placeholder="25"
                className="h-11 rounded-xl border-border/70 bg-background/80"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="start-row">Começar na linha</Label>
              <Input
                id="start-row"
                value={startRow}
                onChange={(event) => setStartRow(event.target.value)}
                inputMode="numeric"
                placeholder="2"
                className="h-11 rounded-xl border-border/70 bg-background/80"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Use esse campo para preservar linhas vinculadas ou calculadas da planilha.
              </p>
            </div>

            <Button
              type="button"
              className="h-11 w-full rounded-xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(216_48%_34%))]"
              disabled={automationMutation.isPending}
              onClick={() => automationMutation.mutate()}
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
                Mostra até 15 linhas processadas pela automação para conferência rápida.
              </p>
            </div>
            {lastResult ? (
              <Badge variant={lastResult.dryRun ? 'secondary' : 'default'} className="h-9 rounded-xl px-3">
                {lastResult.dryRun ? 'Teste sem gravação' : `Aba ${lastResult.sheetName}`}
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
                  <TableHead>Status financeiro</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Situação no Trello</TableHead>
                  <TableHead>Data da ação</TableHead>
                  <TableHead>Card</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!lastResult ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      Execute a automação em modo teste para visualizar a prévia.
                    </TableCell>
                  </TableRow>
                ) : lastResult.preview.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      Nenhuma linha válida foi processada.
                    </TableCell>
                  </TableRow>
                ) : (
                  lastResult.preview.map((row) => (
                    <TableRow key={`${row.rowNumber}-${row.clientName}`} className="bg-background/70 align-top">
                      <TableCell>{row.rowNumber}</TableCell>
                      <TableCell className="min-w-[180px] font-medium">{row.clientName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.status}</Badge>
                      </TableCell>
                      <TableCell className="min-w-[150px]">{row.resultLabel}</TableCell>
                      <TableCell className="min-w-[340px]">
                        <div className="max-h-24 max-w-[760px] overflow-y-auto pr-2 text-xs leading-5 text-muted-foreground">
                          {row.situation || '-'}
                        </div>
                      </TableCell>
                      <TableCell>{row.actionDate || '-'}</TableCell>
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
    </div>
  );
}
