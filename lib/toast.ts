// Toast notification system

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

type ToastListener = (toasts: Toast[]) => void;

class ToastManager {
  private toasts: Toast[] = [];
  private listeners: Set<ToastListener> = new Set();

  subscribe(listener: ToastListener) {
    this.listeners.add(listener);
    listener(this.toasts);
    return () => { this.listeners.delete(listener); };
  }

  private notify() {
    this.listeners.forEach(listener => listener([...this.toasts]));
  }

  private add(type: ToastType, message: string, duration = 5000) {
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2);
    const toast: Toast = { id, type, message, duration };
    
    this.toasts.push(toast);
    this.notify();

    if (duration > 0) {
      setTimeout(() => this.remove(id), duration);
    }

    return id;
  }

  remove(id: string) {
    this.toasts = this.toasts.filter(t => t.id !== id);
    this.notify();
  }

  success(message: string, duration?: number) {
    return this.add('success', message, duration);
  }

  error(message: string, duration?: number) {
    return this.add('error', message, duration ?? 8000);
  }

  warning(message: string, duration?: number) {
    return this.add('warning', message, duration);
  }

  info(message: string, duration?: number) {
    return this.add('info', message, duration);
  }
}

export const toast = new ToastManager();
export type { Toast, ToastType };
