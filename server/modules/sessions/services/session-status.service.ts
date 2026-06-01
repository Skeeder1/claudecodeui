export type SessionStatus =
  | 'needs_attention'
  | 'running'
  | 'done_unread'
  | 'done_read'
  | 'error'
  | 'idle';

type SessionStatusInput = {
  lastEventKind: string | null;
  lastEventAt: string | null;
  lastReadAt: string | null;
  updatedAt: string | null;
  isRunning?: boolean;
};

const RUNNING_HEURISTIC_WINDOW_MS = 60_000;

function isWithinWindow(timestamp: string | null, windowMs: number): boolean {
  if (!timestamp) return false;
  const t = new Date(timestamp).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < windowMs;
}

/**
 * Derives a UI status bucket from the last persisted notification event plus
 * a recent-activity heuristic. No central registry of live processes is
 * exposed by the providers, so `running` is inferred when activity is recent
 * AND no terminal event (`stop`/`error`) has fired since.
 */
export function deriveSessionStatus(input: SessionStatusInput): SessionStatus {
  const { lastEventKind, lastEventAt, lastReadAt, updatedAt, isRunning } = input;

  if (isRunning) return 'running';

  if (lastEventKind === 'error') return 'error';
  if (lastEventKind === 'action_required') return 'needs_attention';

  if (lastEventKind === 'stop') {
    if (!lastReadAt) return 'done_unread';
    const eventTs = lastEventAt ? new Date(lastEventAt).getTime() : 0;
    const readTs = new Date(lastReadAt).getTime();
    return eventTs > readTs ? 'done_unread' : 'done_read';
  }

  // No terminal event recorded — if the row was touched very recently, treat
  // as running. This catches in-flight runs that haven't emitted stop yet.
  if (isWithinWindow(updatedAt, RUNNING_HEURISTIC_WINDOW_MS)) {
    return 'running';
  }

  return 'idle';
}
