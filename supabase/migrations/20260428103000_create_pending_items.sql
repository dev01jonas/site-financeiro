CREATE TABLE IF NOT EXISTS public.pending_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  nome_pessoa TEXT NOT NULL,
  tipo_pendencia TEXT NOT NULL DEFAULT 'Financeira',
  descricao TEXT NOT NULL,
  valor NUMERIC,
  data_vencimento DATE,
  status TEXT NOT NULL DEFAULT 'pendente',
  observacoes TEXT,
  prioridade TEXT NOT NULL DEFAULT 'media',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pending_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage pending_items" ON public.pending_items;
CREATE POLICY "Authenticated users can manage pending_items"
  ON public.pending_items
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_pending_items_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_pending_items_updated_at ON public.pending_items;
CREATE TRIGGER set_pending_items_updated_at
  BEFORE UPDATE ON public.pending_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_pending_items_updated_at();

CREATE INDEX IF NOT EXISTS idx_pending_items_client_id
  ON public.pending_items USING btree (client_id);

CREATE INDEX IF NOT EXISTS idx_pending_items_nome_pessoa
  ON public.pending_items USING btree (nome_pessoa);

CREATE INDEX IF NOT EXISTS idx_pending_items_status
  ON public.pending_items USING btree (status);

CREATE INDEX IF NOT EXISTS idx_pending_items_data_vencimento
  ON public.pending_items USING btree (data_vencimento);
