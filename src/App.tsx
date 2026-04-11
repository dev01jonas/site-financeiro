import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppLayout } from '@/components/AppLayout';
import { ThemeProvider } from '@/components/theme-provider';
import { useAuth } from '@/hooks/useAuth';
import { useApproval } from '@/hooks/useApproval';
import Dashboard from './pages/Dashboard';
import Clientes from './pages/Clientes';
import Cobrancas from './pages/Cobrancas';
import Historico from './pages/Historico';
import Auth from './pages/Auth';
import PendingApproval from './pages/PendingApproval';
import AdminApprovals from './pages/AdminApprovals';
import NotFound from './pages/NotFound';

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  const { approved, isAdmin, loading: approvalLoading } = useApproval();

  if (loading || approvalLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!approved) {
    return <PendingApproval />;
  }

  return (
    <AppLayout isAdmin={isAdmin}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/clientes" element={<Clientes />} />
        <Route path="/cobrancas" element={<Cobrancas />} />
        <Route path="/pagamentos" element={<Navigate to="/cobrancas" replace />} />
        <Route path="/historico" element={<Historico />} />
        {isAdmin && <Route path="/acessos" element={<AdminApprovals />} />}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
  );
}

function AuthRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return <Auth />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<AuthRoute />} />
            <Route path="/*" element={<ProtectedRoutes />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
