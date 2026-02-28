import Link from 'next/link';
import { FileQuestion, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-black bg-grid flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-[#B0FAFF]/[0.02] blur-[80px] pointer-events-none" />
        <div className="relative w-16 h-16 bg-[#0A0A0A] border border-[#B0FAFF]/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <FileQuestion className="w-8 h-8 text-[#B0FAFF]" />
        </div>
        
        <h1 className="text-6xl font-bold mb-2 gradient-text relative">404</h1>
        <h2 className="text-xl font-semibold text-white mb-2 relative">Page Not Found</h2>
        <p className="text-[#737373] mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <div className="flex gap-3 justify-center">
          <Link href="/">
            <Button className="bg-[#B0FAFF] text-black hover:bg-[#B0FAFF]/90">
              <MessageSquare className="w-4 h-4 mr-2" />
              Go to Chat
            </Button>
          </Link>
          <Link href="/settings">
            <Button variant="outline" className="border-[#2A2A2A] text-white hover:bg-[#1A1A1A]">
              Settings
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
