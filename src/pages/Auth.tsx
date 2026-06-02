import { useEffect, useState } from 'react';
import { Lock, Mail, User, Eye, EyeOff, ShieldCheck, FileText, Landmark } from 'lucide-react';
import modaelliLogo from '@/assets/modaelli-logo.png';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useToast } from '@/hooks/use-toast';

async function notifyAdminAccessRequest(email: string, fullName: string) {
  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-access-request`;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
    },
    body: JSON.stringify({
      email,
      fullName,
      origin: window.location.origin,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail =
      payload && typeof payload === 'object'
        ? payload.error || payload.message || payload.details
        : null;

    throw new Error(typeof detail === 'string' && detail.trim() ? detail : 'Falha ao avisar o administrador.');
  }
}

export default function Auth() {
  const { toast } = useToast();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formModeClass, setFormModeClass] = useState('auth-panel-enter');

  useEffect(() => {
    setFormModeClass('auth-panel-enter');
    const timer = window.setTimeout(() => setFormModeClass(''), 420);
    return () => window.clearTimeout(timer);
  }, [isLogin]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          throw error;
        }
      } else {
        const normalizedEmail = email.trim().toLowerCase();
        const normalizedName = fullName.trim();

        const { error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: { full_name: normalizedName },
            emailRedirectTo: window.location.origin,
          },
        });

        if (error) {
          throw error;
        }

        try {
          await notifyAdminAccessRequest(normalizedEmail, normalizedName);
        } catch (notificationError) {
          console.warn('Não foi possível avisar o administrador por e-mail.', notificationError);
        }

        toast({
          title: 'Conta criada com sucesso!',
          description: 'O acesso ficará pendente até que um administrador aprove esta conta.',
        });
        setIsLogin(true);
      }
    } catch (error: unknown) {
      toast({ title: error instanceof Error ? error.message : 'Erro na autenticação', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(43,65,98,0.28),_transparent_38%),linear-gradient(180deg,_rgba(12,18,29,0.08),_transparent_46%)] dark:bg-[radial-gradient(circle_at_top,_rgba(83,118,173,0.16),_transparent_36%),linear-gradient(180deg,_rgba(7,10,17,0.72),_rgba(7,10,17,0.92))]" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,_rgba(180,192,213,0.18),_transparent_62%)] blur-3xl dark:bg-[radial-gradient(circle,_rgba(85,118,170,0.14),_transparent_64%)]" />
      <div className="pointer-events-none absolute -left-20 top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,_rgba(123,146,184,0.16),_transparent_66%)] blur-3xl auth-float-slow" />
      <div className="pointer-events-none absolute -right-16 bottom-10 h-80 w-80 rounded-full bg-[radial-gradient(circle,_rgba(33,57,92,0.14),_transparent_66%)] blur-3xl auth-float-delayed" />

      <div className="absolute right-4 top-4">
        <ThemeToggle className="border border-border/70 bg-card/85 text-foreground shadow-sm backdrop-blur hover:bg-muted" />
      </div>

      <div className="relative grid w-full max-w-6xl overflow-hidden rounded-[2rem] border border-border/70 bg-card/70 shadow-[0_30px_90px_rgba(15,23,42,0.18)] backdrop-blur lg:grid-cols-[1.05fr_0.95fr]">
        <div className="relative hidden overflow-hidden border-r border-white/10 bg-[linear-gradient(160deg,rgba(18,31,49,0.98),rgba(31,50,79,0.94))] p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(125,154,201,0.22),_transparent_28%),radial-gradient(circle_at_bottom_left,_rgba(255,255,255,0.08),_transparent_22%)]" />

          <div className="relative space-y-8">
            <div className="flex items-center gap-4">
              <div className="rounded-[1.35rem] border border-white/15 bg-white/10 p-3 shadow-sm backdrop-blur">
                <img src={modaelliLogo} alt="Modaelli" className="h-14 w-14 rounded-xl object-cover" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-300">Modaelli Advogados</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">Ambiente Financeiro</h1>
              </div>
            </div>

            <div className={`space-y-4 ${formModeClass}`}>
              <p className="max-w-xl text-lg leading-8 text-slate-200">
                {isLogin
                  ? 'Acesse uma área pensada para operação financeira com leitura institucional, segura e objetiva.'
                  : 'Solicite seu acesso em um fluxo elegante e controlado, alinhado à rotina interna do escritório.'}
              </p>

              <div className="grid gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-5 w-5 text-slate-200" />
                    <div>
                      <p className="text-sm font-medium">Acesso controlado</p>
                      <p className="text-sm text-slate-300">Novos cadastros seguem para aprovação antes de entrar no sistema.</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-slate-200" />
                    <div>
                      <p className="text-sm font-medium">Cobranças organizadas</p>
                      <p className="text-sm text-slate-300">Fluxo centralizado para importação, envio, PIX e boleto simples.</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur">
                  <div className="flex items-center gap-3">
                    <Landmark className="h-5 w-5 text-slate-200" />
                    <div>
                      <p className="text-sm font-medium">Linguagem profissional</p>
                      <p className="text-sm text-slate-300">Visual sóbrio, confiável e adequado a uma operação financeira jurídica.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="relative flex items-end justify-between rounded-[1.6rem] border border-white/10 bg-white/6 p-5 backdrop-blur">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-300">Modo atual</p>
              <p className="mt-2 text-2xl font-semibold">{isLogin ? 'Entrada segura' : 'Solicitação guiada'}</p>
            </div>
            <div className="h-14 w-14 rounded-full border border-white/10 bg-white/10 auth-pulse-ring" />
          </div>
        </div>

        <Card className="relative border-0 bg-card/90 shadow-none backdrop-blur">
          <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,rgba(81,125,191,0),rgba(81,125,191,0.9),rgba(81,125,191,0))]" />

          <CardHeader className={`space-y-5 px-6 pt-8 text-center sm:px-8 ${formModeClass}`}>
            <div className="mb-1 flex justify-center lg:hidden">
              <div className="rounded-[1.4rem] border border-border/60 bg-background/80 p-3 shadow-sm">
                <img src={modaelliLogo} alt="Modaelli" className="h-14 w-14 rounded-xl object-cover" />
              </div>
            </div>

            <div className="mx-auto inline-flex rounded-full border border-border/70 bg-background/70 p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setIsLogin(true)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  isLogin ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => setIsLogin(false)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  !isLogin ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Nova conta
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.38em] text-accent">Modaelli Advogados</p>
              <CardTitle className="text-3xl font-semibold tracking-tight">
                {isLogin ? 'Área restrita' : 'Solicitar acesso'}
              </CardTitle>
              <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
                {isLogin
                  ? 'Entre para acompanhar clientes, cobranças e histórico com segurança institucional.'
                  : 'Cadastre sua conta para encaminhar a aprovação e acessar a operação financeira.'}
              </p>
            </div>
          </CardHeader>

          <CardContent className={`space-y-5 px-6 pb-8 sm:px-8 ${formModeClass}`}>
            <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-xs leading-5 text-muted-foreground">
              {isLogin
                ? 'Ambiente destinado ao acompanhamento de clientes, cobranças e histórico de comunicações.'
                : 'Novas contas entram como pendentes até a liberação pelo administrador do escritório.'}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className={`grid transition-all duration-300 ${isLogin ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}>
                <div className="overflow-hidden">
                  <div className="space-y-2 pb-1">
                    <Label htmlFor="name" className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Nome completo
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="name"
                        placeholder="Seu nome"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                        className="h-12 rounded-xl border-border/70 bg-background/80 pl-9"
                        required={!isLogin}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  E-mail
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-12 rounded-xl border-border/70 bg-background/80 pl-9"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Senha
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Mínimo de 6 caracteres"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-12 rounded-xl border-border/70 bg-background/80 pl-9 pr-20"
                    minLength={6}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute right-2 top-1/2 flex h-8 -translate-y-1/2 items-center gap-1.5 rounded-full border border-transparent px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border/70 hover:bg-muted hover:text-foreground"
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    <span className="flex items-center gap-1">
                      <span className={`h-1.5 w-1.5 rounded-full transition-colors ${showPassword ? 'bg-accent/50' : 'bg-accent'}`} />
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </span>
                    <span>{showPassword ? 'Ocultar' : 'Ver'}</span>
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="h-12 w-full rounded-xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(216_48%_34%))] text-primary-foreground shadow-[0_14px_34px_rgba(18,32,52,0.22)] transition-transform hover:-translate-y-0.5 hover:bg-[linear-gradient(135deg,hsl(216_58%_26%),hsl(216_48%_36%))]"
                disabled={loading}
              >
                {loading ? 'Aguarde...' : isLogin ? 'Entrar' : 'Criar conta'}
              </Button>
            </form>

            <div className="mt-4 text-center">
              <button type="button" className="text-sm font-medium text-accent hover:underline" onClick={() => setIsLogin(!isLogin)}>
                {isLogin ? 'Não tem conta? Criar agora' : 'Já tem conta? Entrar'}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
