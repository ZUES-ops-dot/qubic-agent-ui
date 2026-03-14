'use client';

import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';

interface CyberCardProps extends HTMLMotionProps<'div'> {
  children: React.ReactNode;
  className?: string;
  glowColor?: 'cyan' | 'purple' | 'amber' | 'red' | 'green';
  hover?: boolean;
}

const glowColors = {
  cyan: {
    border: 'border-[#B0FAFF]/10',
    hoverBorder: 'hover:border-[#B0FAFF]/30',
    shadow: 'shadow-[0_4px_24px_rgba(176,250,255,0.06)]',
    hoverShadow: 'hover:shadow-[0_8px_48px_rgba(176,250,255,0.12)]',
    glow: 'bg-[#B0FAFF]/15',
    hoverGlow: 'group-hover:bg-[#B0FAFF]/25',
    accent: '#B0FAFF',
  },
  purple: {
    border: 'border-purple-500/10',
    hoverBorder: 'hover:border-purple-500/30',
    shadow: 'shadow-[0_4px_24px_rgba(168,85,247,0.06)]',
    hoverShadow: 'hover:shadow-[0_8px_48px_rgba(168,85,247,0.12)]',
    glow: 'bg-purple-500/15',
    hoverGlow: 'group-hover:bg-purple-500/25',
    accent: '#A855F7',
  },
  amber: {
    border: 'border-amber-500/10',
    hoverBorder: 'hover:border-amber-500/30',
    shadow: 'shadow-[0_4px_24px_rgba(245,158,11,0.06)]',
    hoverShadow: 'hover:shadow-[0_8px_48px_rgba(245,158,11,0.12)]',
    glow: 'bg-amber-500/15',
    hoverGlow: 'group-hover:bg-amber-500/25',
    accent: '#F59E0B',
  },
  red: {
    border: 'border-red-500/10',
    hoverBorder: 'hover:border-red-500/30',
    shadow: 'shadow-[0_4px_24px_rgba(239,68,68,0.06)]',
    hoverShadow: 'hover:shadow-[0_8px_48px_rgba(239,68,68,0.12)]',
    glow: 'bg-red-500/15',
    hoverGlow: 'group-hover:bg-red-500/25',
    accent: '#EF4444',
  },
  green: {
    border: 'border-emerald-500/10',
    hoverBorder: 'hover:border-emerald-500/30',
    shadow: 'shadow-[0_4px_24px_rgba(16,185,129,0.06)]',
    hoverShadow: 'hover:shadow-[0_8px_48px_rgba(16,185,129,0.12)]',
    glow: 'bg-emerald-500/15',
    hoverGlow: 'group-hover:bg-emerald-500/25',
    accent: '#10B981',
  },
};

export function CyberCard({
  children,
  className = '',
  glowColor = 'cyan',
  hover = true,
  ...props
}: CyberCardProps) {
  const colors = glowColors[glowColor];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      whileHover={hover ? { y: -4 } : undefined}
      className={cn(
        'group relative',
        'bg-gradient-to-br from-black/60 to-black/40',
        'backdrop-blur-xl',
        'border rounded-2xl',
        colors.border,
        hover && colors.hoverBorder,
        'p-6',
        colors.shadow,
        hover && colors.hoverShadow,
        'transition-all duration-500',
        'overflow-hidden',
        className
      )}
      {...props}
    >
      {/* Subtle border glow on hover - keeps same color theme */}
      <div className={cn(
        "absolute inset-0 rounded-2xl p-[1px] opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10",
        glowColor === 'cyan' && "bg-gradient-to-r from-[#B0FAFF]/30 via-[#B0FAFF]/50 to-[#B0FAFF]/30",
        glowColor === 'purple' && "bg-gradient-to-r from-purple-500/30 via-purple-500/50 to-purple-500/30",
        glowColor === 'amber' && "bg-gradient-to-r from-amber-500/30 via-amber-500/50 to-amber-500/30",
        glowColor === 'red' && "bg-gradient-to-r from-red-500/30 via-red-500/50 to-red-500/30",
        glowColor === 'green' && "bg-gradient-to-r from-emerald-500/30 via-emerald-500/50 to-emerald-500/30",
      )} />

      {/* Glow effect */}
      <div
        className={cn(
          'absolute -top-40 -right-40 w-80 h-80 rounded-full blur-[100px] transition-all duration-1000',
          colors.glow,
          colors.hoverGlow
        )}
      />

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}

export function CyberCardHeader({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col space-y-1.5 mb-4', className)}>
      {children}
    </div>
  );
}

export function CyberCardTitle({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        'text-lg font-semibold leading-none tracking-tight text-white',
        className
      )}
    >
      {children}
    </h3>
  );
}

export function CyberCardDescription({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn('text-sm text-[#737373]', className)}>{children}</p>
  );
}

export function CyberCardContent({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('', className)}>{children}</div>;
}
