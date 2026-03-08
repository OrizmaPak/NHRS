import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Unexpected UI failure' };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('UI boundary caught error', { error, errorInfo });
  }

  private retry = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4">
        <div className="w-full max-w-lg rounded-lg border border-danger/30 bg-surface p-6 text-center shadow-soft">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-danger" />
          <h1 className="font-display text-xl font-semibold text-foreground">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted">
            The page encountered an unexpected error. You can retry safely or return to the dashboard.
          </p>
          <p className="mt-3 rounded bg-muted/20 px-3 py-2 text-xs text-muted">{this.state.message}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={this.retry}>Retry</Button>
            <Button variant="outline" onClick={() => window.location.assign('/app')}>
              Go to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
