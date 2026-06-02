import { MINUTE_MS, HOUR_MS, DAY_MS } from '../constants/time';

export function formatLocalDate(
  dateString: string,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  return new Date(dateString).toLocaleDateString('en-US', options);
}

export function formatLocalTime(dateString: string | number): string {
  return new Date(dateString).toLocaleTimeString();
}

// Pass `currentTime` for reactive updates; omit to use Date.now().
export function formatCompactAge(
  dateString: string | null,
  currentTime?: Date,
): string {
  if (!dateString) return '';

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';

  const now = currentTime ? currentTime.getTime() : Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const diffInMinutes = Math.floor(diffMs / MINUTE_MS);

  if (diffInMinutes < 1) return '<1m';
  if (diffInMinutes < 60) return `${diffInMinutes}m`;

  const diffInHours = Math.floor(diffMs / HOUR_MS);
  if (diffInHours < 24) return `${diffInHours}hr`;

  return `${Math.floor(diffMs / DAY_MS)}d`;
}
