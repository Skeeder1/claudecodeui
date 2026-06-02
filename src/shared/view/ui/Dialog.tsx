import {
  createContext,
  useContext,
  forwardRef,
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  isValidElement,
  cloneElement,
  type FC,
  type ReactNode,
  type MutableRefObject,
  type HTMLAttributes,
  type ButtonHTMLAttributes,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../../../lib/utils';

type DialogContextValue = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: MutableRefObject<HTMLElement | null>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('Dialog components must be used within <Dialog>');
  return ctx;
}

type DialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: ReactNode;
}

const Dialog: FC<DialogProps> = ({ open: controlledOpen, onOpenChange: controlledOnOpenChange, defaultOpen = false, children }) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLElement | null>(null) as MutableRefObject<HTMLElement | null>;
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      controlledOnOpenChange?.(next);
    },
    [isControlled, controlledOnOpenChange]
  );

  const value = useMemo(() => ({ open, onOpenChange, triggerRef }), [open, onOpenChange]);

  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
};

const DialogTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }>(
  ({ onClick, children, asChild, ...props }, ref) => {
    const { onOpenChange, triggerRef } = useDialog();

    const handleClick = useCallback(
      (e: MouseEvent<HTMLButtonElement>) => {
        onOpenChange(true);
        onClick?.(e);
      },
      [onOpenChange, onClick]
    );

    if (asChild && isValidElement(children)) {
      const child = children as React.ReactElement<Record<string, unknown>>;
      return cloneElement(child, {
        onClick: (e: MouseEvent<HTMLElement>) => {
          onOpenChange(true);
          (child.props.onClick as ((e: MouseEvent<HTMLElement>) => void) | undefined)?.(e);
        },
        ref: (node: HTMLElement | null) => {
          triggerRef.current = node;
          if (typeof ref === 'function') ref(node as HTMLButtonElement | null);
          else if (ref) (ref as MutableRefObject<HTMLElement | null>).current = node;
        },
      });
    }

    return (
      <button
        ref={(node) => {
          triggerRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        type="button"
        onClick={handleClick}
        {...props}
      >
        {children}
      </button>
    );
  }
);
DialogTrigger.displayName = 'DialogTrigger';

type DialogContentProps = HTMLAttributes<HTMLDivElement> & {
  onEscapeKeyDown?: () => void;
  onPointerDownOutside?: () => void;
};

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, onEscapeKeyDown, onPointerDownOutside, ...props }, ref) => {
    const { open, onOpenChange, triggerRef } = useDialog();
    const contentRef = useRef<HTMLDivElement | null>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
      if (open) {
        previousFocusRef.current = document.activeElement as HTMLElement;
      } else if (previousFocusRef.current) {
        const restoreTarget = triggerRef.current || previousFocusRef.current;
        restoreTarget?.focus();
        previousFocusRef.current = null;
      }
    }, [open, triggerRef]);

    useEffect(() => {
      if (!open) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onEscapeKeyDown?.();
          onOpenChange(false);
          return;
        }

        if (e.key === 'Tab' && contentRef.current) {
          const focusable = Array.from(
            contentRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
          );
          if (focusable.length === 0) return;

          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      document.addEventListener('keydown', handleKeyDown, true);

      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      return () => {
        document.removeEventListener('keydown', handleKeyDown, true);
        document.body.style.overflow = prev;
      };
    }, [open, onOpenChange, onEscapeKeyDown]);

    useEffect(() => {
      if (open && contentRef.current) {
        requestAnimationFrame(() => {
          const first = contentRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
          first?.focus();
        });
      }
    }, [open]);

    if (!open) return null;

    return createPortal(
      <div className="fixed inset-0 z-50">
        <div
          className="fixed inset-0 animate-dialog-overlay-show bg-black/50 backdrop-blur-sm"
          onClick={() => {
            onPointerDownOutside?.();
            onOpenChange(false);
          }}
          aria-hidden
        />
        <div
          ref={(node) => {
            contentRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) (ref as MutableRefObject<HTMLDivElement | null>).current = node;
          }}
          role="dialog"
          aria-modal="true"
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border bg-popover text-popover-foreground shadow-lg',
            'animate-dialog-content-show',
            className
          )}
          {...props}
        >
          {children}
        </div>
      </div>,
      document.body
    );
  }
);
DialogContent.displayName = 'DialogContent';

const DialogTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn('sr-only', className)} {...props} />
  )
);
DialogTitle.displayName = 'DialogTitle';

export { Dialog, DialogTrigger, DialogContent, DialogTitle, useDialog };
