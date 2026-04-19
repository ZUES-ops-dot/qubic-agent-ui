'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-black bg-grid flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-[#EF4444]/[0.02] blur-[80px] pointer-events-none" />
        <div className="relative w-16 h-16 bg-[#0A0A0A] border border-[#EF4444]/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-8 h-8 text-[#EF4444]" />
        </div>
        
        <h1 className="text-2xl font-bold text-white mb-2 relative">Something went wrong</h1>
        <p className="text-[#737373] mb-6">
          An unexpected error occurred. Please try again or return to the home page.
        </p>

        {error.message && (
          <div className="bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg p-4 mb-6 text-left">
            <p className="text-xs text-[#525252] mb-1">Error details:</p>
            <p className="text-sm text-[#EF4444] font-mono break-all">{error.message}</p>
          </div>
        )}

        <div className="flex gap-3 justify-center">
          <Button
            onClick={reset}
            className="bg-[#B0FAFF] text-black hover:bg-[#B0FAFF]/90"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
          <Link href="/">
            <Button variant="outline" className="border-[#2A2A2A] text-white hover:bg-[#1A1A1A]">
              <Home className="w-4 h-4 mr-2" />
              Home
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
