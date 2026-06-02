import { Clock3, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function EmBreve() {
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-[linear-gradient(135deg,rgba(18,31,49,0.96),rgba(28,46,73,0.88))] text-white shadow-[0_26px_80px_rgba(15,23,42,0.18)]">
        <div className="px-6 py-8 lg:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-300">Em breve</p>
          <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Novas ferramentas financeiras serão liberadas aos poucos.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
            Esta área está reservada para melhorias futuras. Por enquanto, vamos manter o foco nas cobranças,
            clientes, dashboard e histórico que já estão prontos para uso.
          </p>
        </div>
      </section>

      <Card className="border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
        <CardContent className="grid gap-4 p-6 md:grid-cols-[auto_1fr] md:items-center">
          <div className="rounded-2xl bg-primary/10 p-4 text-primary">
            <Clock3 className="h-8 w-8" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Análise de Pendências pausada por enquanto</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A estrutura fica guardada para retomarmos depois, sem atrapalhar a rotina atual do escritório.
            </p>
          </div>
          <div className="hidden rounded-2xl bg-muted/50 p-4 text-muted-foreground md:block">
            <Sparkles className="h-6 w-6" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
