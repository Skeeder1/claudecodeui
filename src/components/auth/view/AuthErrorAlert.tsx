import { cn } from '../../../lib/utils';

type AuthErrorAlertProps = {
  errorMessage: string;
  className?: string;
};

export default function AuthErrorAlert({ errorMessage, className }: AuthErrorAlertProps) {
  if (!errorMessage) {
    return null;
  }

  return (
    <div className={cn('rounded-md border border-red-300 bg-red-100 p-3 dark:border-red-800 dark:bg-red-900/20', className)}>
      <p className="text-sm text-red-700 dark:text-red-400">{errorMessage}</p>
    </div>
  );
}
