import { cn } from '../../../lib/utils';
import Spinner from './Spinner';

type LoadingStateProps = {
  text: string;
  variant?: 'inline' | 'overlay';
  zIndex?: string;
  contentClassName?: string;
};

export default function LoadingState({
  text,
  variant = 'inline',
  zIndex = 'z-[200]',
  contentClassName,
}: LoadingStateProps) {
  const spinnerContent = (
    <div className="flex items-center gap-3">
      <Spinner color="blue" />
      <span className="text-gray-900 dark:text-white">{text}</span>
    </div>
  );

  if (variant === 'overlay') {
    return (
      <div className={`fixed inset-0 ${zIndex} md:flex md:items-center md:justify-center md:bg-black/50`}>
        <div className={cn('flex h-full w-full items-center justify-center p-8 md:h-auto md:w-auto md:rounded-lg', contentClassName ?? 'bg-white dark:bg-gray-900')}>
          {spinnerContent}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full w-full items-center justify-center', contentClassName ?? 'bg-background')}>
      {spinnerContent}
    </div>
  );
}
