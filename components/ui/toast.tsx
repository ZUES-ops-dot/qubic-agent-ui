'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { toast as toastManager, type Toast, type ToastType } from '@/lib/toast';
import { cn } from '@/lib/utils';

const icons: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const styles: Record<ToastType, string> = {
  success: 'bg-[#10B981]/10 border-[#10B981]/30 text-[#10B981]',
  error: 'bg-[#EF4444]/10 border-[#EF4444]/30 text-[#EF4444]',
  warning: 'bg-[#F59E0B]/10 border-[#F59E0B]/30 text-[#F59E0B]',
  info: 'bg-[#B0FAFF]/10 border-[#B0FAFF]/30 text-[#B0FAFF]',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = icons[toast.type];

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-lg border backdrop-blur-sm shadow-lg',
        styles[toast.type]
      )}
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      <span className="text-sm text-white flex-1">{toast.message}</span>
      <button
        onClick={onDismiss}
        className="p-1 hover:bg-white/10 rounded transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    return toastManager.subscribe(setToasts);
  }, []);

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      <AnimatePresence>
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={() => toastManager.remove(toast.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

// Re-export toast manager for easy imports
export { toast } from '@/lib/toast';
