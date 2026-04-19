import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div className="min-h-screen bg-black bg-grid flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 relative">
        <div className="absolute w-32 h-32 rounded-full bg-[#B0FAFF]/[0.03] blur-[40px] pointer-events-none" />
        <div className="relative w-12 h-12 bg-[#0A0A0A] border border-[#B0FAFF]/20 rounded-xl flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-[#B0FAFF] animate-spin" />
        </div>
        <p className="text-[#525252] text-sm relative">Loading...</p>
      </div>
    </div>
  );
}
