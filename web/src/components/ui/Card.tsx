// Card Component

import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';

export interface CardProps {
  variant?: 'default' | 'elevated' | 'gradient';
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', interactive = false, padding = 'md', children, onClick }, ref) => {
    const baseClasses = clsx(
      'rounded-2xl transition-all duration-200',
      {
        // Variants
        'bg-card border border-border': variant === 'default',
        'bg-card-elevated border border-border shadow-lg shadow-black/5 dark:shadow-black/20': variant === 'elevated',
        'bg-gradient-to-br from-primary-500 to-primary-700 text-white': variant === 'gradient',
        // Interactive
        'cursor-pointer': interactive,
        // Padding
        'p-0': padding === 'none',
        'p-4': padding === 'sm',
        'p-6': padding === 'md',
        'p-8': padding === 'lg',
      },
      className
    );

    if (interactive) {
      return (
        <motion.div
          ref={ref}
          onClick={onClick}
          whileHover={{ scale: 1.01, y: -2 }}
          whileTap={{ scale: 0.99 }}
          className={baseClasses}
        >
          {children}
        </motion.div>
      );
    }

    return <div ref={ref} className={baseClasses}>{children}</div>;
  }
);

Card.displayName = 'Card';

// Export additional card sub-components for HAMMA dashboard
export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardHeader({ className = '', ...props }: CardHeaderProps) {
  return (
    <div
      className={`flex flex-col space-y-1.5 p-6 ${className}`}
      {...props}
    />
  );
}

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}

export function CardTitle({ className = '', ...props }: CardTitleProps) {
  return (
    <h3
      className={`text-2xl font-semibold leading-none tracking-tight ${className}`}
      {...props}
    />
  );
}

export interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardContent({ className = '', ...props }: CardContentProps) {
  return <div className={`p-6 pt-0 ${className}`} {...props} />;
}
