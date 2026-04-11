import { Link, useLocation } from 'react-router-dom';
import modaelliLogo from '@/assets/modaelli-logo.png';
import { LayoutDashboard, Users, FileText, History, Menu, X, LogOut, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/clientes', label: 'Clientes', icon: Users },
  { path: '/cobrancas', label: 'Cobrancas', icon: FileText },
  { path: '/historico', label: 'Historico', icon: History },
];

interface AppLayoutProps {
  children: React.ReactNode;
  isAdmin?: boolean;
}

export function AppLayout({ children, isAdmin }: AppLayoutProps) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, signOut } = useAuth();

  const allNavItems = isAdmin
    ? [...navItems, { path: '/acessos', label: 'Acessos', icon: ShieldCheck }]
    : navItems;

  return (
    <div className="flex h-screen overflow-hidden">
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform md:static md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-3 border-b border-sidebar-border px-6 py-5">
          <img src={modaelliLogo} alt="Modaelli" className="h-9 w-9 rounded-lg object-cover" />
          <div>
            <h1 className="text-sm font-semibold tracking-tight">Modaelli</h1>
            <p className="text-xs text-sidebar-foreground/60">Gestao Financeira</p>
          </div>
          <button className="ml-auto md:hidden" onClick={() => setMobileOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {allNavItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-primary'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-sidebar-border px-4 py-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-sidebar-foreground/60">Tema da interface</p>
            <ThemeToggle className="text-sidebar-foreground/70 hover:text-sidebar-foreground" />
          </div>
          {user && (
            <div className="flex items-center justify-between">
              <p className="max-w-[140px] truncate text-xs text-sidebar-foreground/60">{user.email}</p>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-sidebar-foreground/60 hover:text-sidebar-foreground"
                onClick={signOut}
                title="Sair"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
          <p className="text-xs text-sidebar-foreground/50">v1.1 - Modaelli Financeiro</p>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-4 border-b bg-card px-6 py-3 md:hidden">
          <button onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-sm font-semibold">Modaelli</h1>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
