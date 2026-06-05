# Site Financeiro

## Rodando localmente

1. Instale as dependências:

```bash
npm install
```

2. Crie um arquivo `.env` na raiz do projeto usando o `.env.example` como base:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=SUA-CHAVE-PUBLICAVEL
```

3. Inicie o servidor de desenvolvimento:

```bash
npm run dev
```

4. Abra no navegador:

```text
http://localhost:8080
```

## Observações

- Este projeto usa Vite com porta fixa `8080`.
- Sem as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`, a interface não consegue inicializar a autenticação.
