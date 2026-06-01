import { sessionsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

type ToggleSessionStarResult = {
  isStarred: boolean;
};

function normalizeSessionId(sessionId: string): string {
  return sessionId.trim();
}

/**
 * Flips `sessions.isStarred` for one session and returns the new state.
 * Mirrors `toggleProjectStar` so the favorites view can rely on the same
 * optimistic-update contract as the project star action.
 */
export function toggleSessionStar(sessionId: string): ToggleSessionStarResult {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    throw new AppError('sessionId is required', {
      code: 'SESSION_ID_REQUIRED',
      statusCode: 400,
    });
  }

  const session = sessionsDb.getSessionById(normalizedSessionId);
  if (!session) {
    throw new AppError('Session not found', {
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });
  }

  const nextStarredState = !Boolean(session.isStarred);
  sessionsDb.updateSessionIsStarred(normalizedSessionId, nextStarredState);

  return { isStarred: nextStarredState };
}
