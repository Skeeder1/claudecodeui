import { cn } from '../../../lib/utils';

type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';
type SpinnerColor = 'muted' | 'primary' | 'white' | 'yellow' | 'gray' | 'blue';

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  xs: 'h-3 w-3 border-[1.5px]',
  sm: 'h-4 w-4 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-6 w-6 border-2',
};

const COLOR_CLASSES: Record<SpinnerColor, string> = {
  muted: 'border-muted-foreground border-t-transparent',
  primary: 'border-primary border-t-transparent',
  white: 'border-white border-t-transparent',
  yellow: 'border-yellow-400 border-t-transparent',
  gray: 'border-gray-400 border-t-transparent',
  blue: 'border-blue-600 border-t-transparent',
};

type SpinnerProps = {
  size?: SpinnerSize;
  color?: SpinnerColor;
  className?: string;
};

export default function Spinner({ size = 'lg', color = 'muted', className }: SpinnerProps) {
  return (
    <div
      className={cn(
        'animate-spin rounded-full',
        SIZE_CLASSES[size],
        COLOR_CLASSES[color],
        className,
      )}
    />
  );
}
