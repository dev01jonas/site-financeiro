import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  message?: string;
  stack?: string;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
    message: undefined,
    stack: undefined,
  };

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || 'Erro desconhecido na interface.',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('AppErrorBoundary', error, errorInfo);
    this.setState({
      stack: errorInfo.componentStack || error.stack || undefined,
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="w-full max-w-xl border-border/70 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
          <CardHeader>
            <CardTitle className="text-xl">A tela encontrou um problema</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">
              A interface foi protegida para não cair inteira. Recarregue a página e, se o problema continuar, me diga
              em qual botão ou tela aconteceu.
            </p>
            {this.state.message ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-6 text-destructive">
                <strong>Erro:</strong> {this.state.message}
              </div>
            ) : null}
            <Button onClick={this.handleReload} className="rounded-xl">
              Recarregar página
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
}
