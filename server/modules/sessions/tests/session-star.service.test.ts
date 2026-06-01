import assert from 'node:assert/strict';
import test from 'node:test';

import { sessionsDb } from '@/modules/database/index.js';
import { toggleSessionStar } from '@/modules/sessions/services/session-star.service.js';
import { AppError } from '@/shared/utils.js';

type SessionRow = {
  session_id: string;
  provider: string;
  project_path: string | null;
  jsonl_path: string | null;
  custom_name: string | null;
  isArchived: number;
  isStarred: number;
  last_event_kind: string | null;
  last_event_at: string | null;
  last_read_at: string | null;
  created_at: string;
  updated_at: string;
  last_user_message_at: string | null;
};

test('toggleSessionStar throws when sessionId is missing', () => {
  assert.throws(
    () => toggleSessionStar('   '),
    (error: unknown) =>
      error instanceof AppError
      && error.code === 'SESSION_ID_REQUIRED'
      && error.statusCode === 400,
  );
});

test('toggleSessionStar throws when session does not exist', () => {
  const originalGetSessionById = sessionsDb.getSessionById;
  try {
    sessionsDb.getSessionById = () => null;
    assert.throws(
      () => toggleSessionStar('session-1'),
      (error: unknown) =>
        error instanceof AppError
        && error.code === 'SESSION_NOT_FOUND'
        && error.statusCode === 404,
    );
  } finally {
    sessionsDb.getSessionById = originalGetSessionById;
  }
});

test('toggleSessionStar flips star state and persists it', () => {
  const originalGetSessionById = sessionsDb.getSessionById;
  const originalUpdateSessionIsStarred = sessionsDb.updateSessionIsStarred;

  let capturedSessionId = '';
  let capturedState = false;

  try {
    sessionsDb.getSessionById = () =>
      ({
        session_id: 'session-1',
        provider: 'claude',
        project_path: '/workspace/p',
        jsonl_path: null,
        custom_name: null,
        isArchived: 0,
        isStarred: 0,
        last_event_kind: null,
        last_event_at: null,
        last_read_at: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        last_user_message_at: null,
      }) as SessionRow;
    sessionsDb.updateSessionIsStarred = (sessionId: string, isStarred: boolean) => {
      capturedSessionId = sessionId;
      capturedState = isStarred;
    };

    const result = toggleSessionStar('session-1');

    assert.equal(result.isStarred, true);
    assert.equal(capturedSessionId, 'session-1');
    assert.equal(capturedState, true);
  } finally {
    sessionsDb.getSessionById = originalGetSessionById;
    sessionsDb.updateSessionIsStarred = originalUpdateSessionIsStarred;
  }
});
