'use client';

import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import { forwardRef } from 'react';

type AnimatedButtonProps = {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  glow?: boolean;
  children?: React.ReactNode;
} & Omit<HTMLMotionProps<'button'>, 'children'>;

const variants = {
  primary: 'bg-[#B0FAFF] text-[#171717] hover:bg-[#B0FAFF]/90',
  secondary: 'bg-[#1F1F1F] text-white border border-[#2A2A2A] hover:bg-[#2A2A2A]',
  ghost: 'bg-transparent text-[#A3A3A3] hover:text-white hover:bg-[#1F1F1F]',
  danger: 'bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/50 hover:bg-[#EF4444]/20',
};

const sizes = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export const AnimatedButton = forwardRef<HTMLButtonElement, AnimatedButtonProps>(
  ({ className, variant = 'primary', size = 'md', glow = false, children, ...props }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-[#B0FAFF]/50 focus:ring-offset-2 focus:ring-offset-[#171717]',
          'disabled:opacity-50 disabled:pointer-events-none',
          variants[variant],
          sizes[size],
          glow && variant === 'primary' && 'glow-primary',
          className
        )}
        {...props}
      >
        {children}
      </motion.button>
    );
  }
);

AnimatedButton.displayName = 'AnimatedButton';
