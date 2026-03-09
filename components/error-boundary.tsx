'use client';

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  scope?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Unexpected UI error',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[${this.props.scope || 'ui'}] Render crash captured by ErrorBoundary`, {
      error,
      componentStack: info.componentStack,
    });
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-black bg-grid flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center bg-[#0A0A0A]/80 border border-[#1A1A1A] rounded-2xl p-6">
          <div className="w-14 h-14 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/20 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7 text-[#EF4444]" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">UI component crashed</h2>
          <p className="text-sm text-[#737373] mb-4">
            A rendering error was caught before it could crash the whole page.
          </p>
          {this.state.errorMessage ? (
            <p className="text-xs text-[#EF4444] break-all mb-4">{this.state.errorMessage}</p>
          ) : null}
          <Button onClick={this.handleReset} className="bg-[#B0FAFF] text-black hover:bg-[#B0FAFF]/90">
            <RefreshCw className="w-4 h-4 mr-2" />
            Recover UI
          </Button>
        </div>
      </div>
    );
  }
}
