import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  ArrowRight,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { parseClientCSV } from '@/lib/csv-utils';

type Client = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
};

type ClientForm = {
  name: string;
  email: string;
  phone: string;
};

const EMPTY_FORM: ClientForm = {
  name: '',
  email: '',
  phone: '',
};

const CLIENTS_PAGE_SIZE = 1000;

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function formatOptionalValue(value?: string | null) {
  return value?.trim() ? value : '-';
}

export default function Clientes() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const csvInputId = useId();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM);

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const allClients: Client[] = [];
      let from = 0;

      while (true) {
        const to = from + CLIENTS_PAGE_SIZE - 1;
        const { data, error } = await supabase
          .from('clients')
          .select('id, name, email, phone')
          .order('name')
          .range(from, to);

        if (error) {
          throw error;
        }

        const batch = (data || []) as Client[];
        allClients.push(...batch);

        if (batch.length < CLIENTS_PAGE_SIZE) {
          break;
        }

        from += CLIENTS_PAGE_SIZE;
      }

      return allClients;
    },
  });

  const normalizedSearch = normalizeText(search);
  const filteredClients = clients.filter((client) => {
    if (!normalizedSearch) {
      return true;
    }

    return [client.name, client.email, client.phone || ''].some((value) =>
      normalizeText(value).includes(normalizedSearch),
    );
  });

  const clientsWithEmail = clients.filter((client) => !!client.email.trim()).length;
  const clientsWithPhone = clients.filter((client) => !!client.phone?.trim()).length;

  const saveMutation = useMutation({
    mutationFn: async (client: { name: string; email: string; phone?: string; id?: string }) => {
      const payload = {
        name: client.name.trim(),
        email: client.email.trim().toLowerCase(),
        phone: client.phone?.trim() || null,
      };

      if (client.id) {
        const { error } = await supabase.from('clients').update(payload).eq('id', client.id);
        if (error) {
          throw error;
        }
        return;
      }

      const { error } = await supabase.from('clients').insert(payload);
      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setDialogOpen(false);
      setEditingClient(null);
      setForm(EMPTY_FORM);
      toast({ title: 'Cliente salvo com sucesso!' });
    },
    onError: () => {
      toast({ title: 'Erro ao salvar cliente', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('clients').delete().eq('id', id);
      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast({ title: 'Cliente removido' });
    },
    onError: () => {
      toast({ title: 'Erro ao remover cliente', variant: 'destructive' });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const parsed = parseClientCSV(text).map((client) => ({
        name: client.name.trim(),
        email: client.email.trim().toLowerCase(),
        phone: client.phone?.trim() || null,
      }));

      if (parsed.length === 0) {
        throw new Error('Nenhum registro válido encontrado no CSV.');
      }

      const existingKeys = new Set(
        clients.map((client) => `${normalizeText(client.name)}::${client.email.trim().toLowerCase()}`),
      );
      const batchKeys = new Set<string>();

      const toInsert = parsed.filter((client) => {
        if (!client.name || !client.email) {
          return false;
        }

        const key = `${normalizeText(client.name)}::${client.email}`;
        if (existingKeys.has(key) || batchKeys.has(key)) {
          return false;
        }

        batchKeys.add(key);
        return true;
      });

      if (toInsert.length === 0) {
        return { imported: 0, skipped: parsed.length };
      }

      const { error } = await supabase.from('clients').insert(toInsert);
      if (error) {
        throw error;
      }

      return { imported: toInsert.length, skipped: parsed.length - toInsert.length };
    },
    onSuccess: ({ imported, skipped }) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });

      if (imported === 0) {
        toast({
          title: 'Nenhum cliente novo foi importado',
          description:
            skipped > 0 ? `${skipped} registro(s) foram ignorados por duplicidade ou dados incompletos.` : undefined,
        });
        return;
      }

      toast({
        title: `${imported} cliente(s) importado(s) com sucesso!`,
        description:
          skipped > 0 ? `${skipped} registro(s) foram ignorados por duplicidade ou dados incompletos.` : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: error.message || 'Erro ao importar CSV', variant: 'destructive' });
    },
  });

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setForm({
      name: client.name,
      email: client.email,
      phone: client.phone || '',
    });
    setDialogOpen(true);
  };

  const handleNew = () => {
    setEditingClient(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const handleCSVUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      importMutation.mutate(file);
    }
    event.target.value = '';
  };

  const handleDelete = (client: Client) => {
    const shouldDelete = window.confirm(`Remover o cliente "${client.name}"?`);
    if (!shouldDelete) {
      return;
    }

    deleteMutation.mutate(client.id);
  };

  const infoCards = [
    {
      title: 'Base total',
      value: clients.length,
      subtitle: 'Cadastros disponíveis para vinculação.',
      icon: Users,
    },
    {
      title: 'Com e-mail ativo',
      value: clientsWithEmail,
      subtitle: 'Prontos para comunicações e cobranças.',
      icon: Mail,
    },
    {
      title: 'Contato telefônico',
      value: clientsWithPhone,
      subtitle: 'Apoio para confirmações e follow-up.',
      icon: Phone,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-[linear-gradient(135deg,rgba(18,31,49,0.96),rgba(28,46,73,0.88))] text-white shadow-[0_26px_80px_rgba(15,23,42,0.18)]">
        <div className="grid gap-8 px-6 py-7 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-300">Relacionamento com clientes</p>
            <div className="space-y-3">
              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Base de contatos preparada para a operação financeira do escritório.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                Organize nomes, e-mails e telefones em um cadastro limpo, pronto para vinculação automática nas
                cobranças e para a continuidade das comunicações do Modaelli Advogados.
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-[1.4rem] border border-white/10 bg-white/5 p-4 backdrop-blur sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Cobertura da base</p>
              <p className="mt-3 text-3xl font-semibold text-white">{clientsWithEmail}</p>
              <p className="mt-2 text-sm text-slate-300">
                clientes com e-mail pronto para cobranças e comunicações oficiais.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Cadastros</p>
              <p className="mt-3 text-3xl font-semibold text-white">{clients.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Telefone</p>
              <p className="mt-3 text-3xl font-semibold text-white">{clientsWithPhone}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">Clientes</h2>
          <p className="text-sm text-muted-foreground">
            Importe, revise e mantenha a base institucional pronta para os próximos envios.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input type="file" accept=".csv" id={csvInputId} className="hidden" onChange={handleCSVUpload} />

          <Button
            variant="outline"
            size="sm"
            onClick={() => document.getElementById(csvInputId)?.click()}
            disabled={importMutation.isPending}
            className="rounded-xl border-border/70"
          >
            <Upload className="mr-2 h-4 w-4" />
            {importMutation.isPending ? 'Importando...' : 'Importar CSV'}
          </Button>

          <Button
            size="sm"
            onClick={handleNew}
            className="rounded-xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(216_48%_34%))] shadow-[0_14px_30px_rgba(18,32,52,0.18)]"
          >
            <Plus className="mr-2 h-4 w-4" />
            Novo cliente
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {infoCards.map((card) => (
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
        <CardHeader className="gap-4 border-b border-border/60 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">Base de clientes</CardTitle>
            <p className="text-sm text-muted-foreground">
              Busca rápida, edição manual e acompanhamento da cobertura dos contatos.
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:max-w-xl sm:flex-row sm:items-center sm:justify-end">
            <div className="relative w-full sm:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, e-mail ou telefone..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-11 rounded-xl border-border/70 bg-background/80 pl-9"
              />
            </div>

            <Badge variant="outline" className="h-11 rounded-xl px-4 text-sm">
              {isLoading ? 'Carregando...' : `${filteredClients.length} registro(s)`}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-accent" />
                Cadastros prontos
              </div>
              <p className="mt-3 text-2xl font-semibold">{clientsWithEmail}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Contatos aptos para vínculo automático nas cobranças.
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Mail className="h-4 w-4 text-accent" />
                Qualidade da base
              </div>
              <p className="mt-3 text-2xl font-semibold">
                {clients.length ? Math.round((clientsWithEmail / clients.length) * 100) : 0}%
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Percentual dos clientes com e-mail validado para comunicação.
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ArrowRight className="h-4 w-4 text-accent" />
                Próximo passo
              </div>
              <p className="mt-3 text-base font-medium">Atualizar registros sem contato</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Priorize clientes sem telefone ou e-mail antes da próxima rotina de cobrança.
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-[1.35rem] border border-border/70">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead className="w-[120px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : filteredClients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      {search
                        ? 'Nenhum cliente encontrado para essa busca.'
                        : 'Nenhum cliente cadastrado. Adicione manualmente ou importe um CSV.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredClients.map((client) => (
                    <TableRow key={client.id} className="bg-background/70">
                      <TableCell className="font-medium">{client.name}</TableCell>
                      <TableCell>{formatOptionalValue(client.email)}</TableCell>
                      <TableCell>{formatOptionalValue(client.phone)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => handleEdit(client)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-xl"
                            onClick={() => handleDelete(client)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingClient(null);
            setForm(EMPTY_FORM);
          }
        }}
      >
        <DialogContent className="border-border/70 bg-card/95 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
          <DialogHeader>
            <DialogTitle>{editingClient ? 'Editar cliente' : 'Novo cliente'}</DialogTitle>
          </DialogHeader>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveMutation.mutate({ ...form, id: editingClient?.id });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="client-name">Nome</Label>
              <Input
                id="client-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className="h-11 rounded-xl border-border/70 bg-background/80"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="client-email">E-mail</Label>
              <Input
                id="client-email"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                className="h-11 rounded-xl border-border/70 bg-background/80"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="client-phone">Telefone (opcional)</Label>
              <Input
                id="client-phone"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                className="h-11 rounded-xl border-border/70 bg-background/80"
              />
            </div>

            <Button
              type="submit"
              className="h-11 w-full rounded-xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(216_48%_34%))]"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
