import { createContext, useContext, forwardRef, useMemo, type HTMLAttributes } from 'react';
import { cn } from '../../../lib/utils';

/* ─── Types ──────────────────────────────────────────────────────── */

export type QueueItemStatus = 'completed' | 'in_progress' | 'pending';

/* ─── Context ────────────────────────────────────────────────────── */

type QueueItemContextValue = {
  status: QueueItemStatus;
}

const QueueItemContext = createContext<QueueItemContextValue | null>(null);

function useQueueItem() {
  const ctx = useContext(QueueItemContext);
  if (!ctx) throw new Error('QueueItem sub-components must be used within <QueueItem>');
  return ctx;
}

/* ─── Queue ──────────────────────────────────────────────────────── */

export const Queue = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="queue"
      role="list"
      className={cn('space-y-0.5', className)}
      {...props}
    />
  ),
);
Queue.displayName = 'Queue';

/* ─── QueueItem ──────────────────────────────────────────────────── */

export type QueueItemProps = HTMLAttributes<HTMLDivElement> & {
  status?: QueueItemStatus;
};

export const QueueItem = forwardRef<HTMLDivElement, QueueItemProps>(
  ({ status = 'pending', className, children, ...props }, ref) => {
    const value = useMemo(() => ({ status }), [status]);

    return (
      <QueueItemContext.Provider value={value}>
        <div
          ref={ref}
          data-slot="queue-item"
          data-status={status}
          role="listitem"
          className={cn('flex items-start gap-2 py-0.5', className)}
          {...props}
        >
          {children}
        </div>
      </QueueItemContext.Provider>
    );
  },
);
QueueItem.displayName = 'QueueItem';

/* ─── QueueItemIndicator ─────────────────────────────────────────── */

export const QueueItemIndicator = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { status } = useQueueItem();

    return (
      <div
        ref={ref}
        data-slot="queue-item-indicator"
        aria-hidden="true"
        className={cn('mt-0.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center', className)}
        {...props}
      >
        {status === 'completed' && (
          <svg className="h-3.5 w-3.5 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        {status === 'in_progress' && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500 dark:bg-blue-400" />
        )}
        {status === 'pending' && (
          <svg className="h-3.5 w-3.5 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" strokeWidth={2} />
          </svg>
        )}
      </div>
    );
  },
);
QueueItemIndicator.displayName = 'QueueItemIndicator';

/* ─── QueueItemContent ───────────────────────────────────────────── */

export const QueueItemContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const { status } = useQueueItem();

    return (
      <div
        ref={ref}
        data-slot="queue-item-content"
        className={cn(
          'min-w-0 flex-1 text-xs',
          status === 'completed' && 'text-muted-foreground line-through',
          status === 'in_progress' && 'font-medium text-foreground',
          status === 'pending' && 'text-foreground',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
QueueItemContent.displayName = 'QueueItemContent';
