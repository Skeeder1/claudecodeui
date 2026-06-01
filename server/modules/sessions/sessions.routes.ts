import express from 'express';

import { sessionsDb } from '@/modules/database/index.js';
import { toggleSessionStar } from '@/modules/sessions/services/session-star.service.js';
import { deriveSessionStatus, type SessionStatus } from '@/modules/sessions/services/session-status.service.js';
import { asyncHandler, normalizeProjectPath } from '@/shared/utils.js';

const router = express.Router();

type StarredSessionPayload = {
  sessionId: string;
  provider: string;
  title: string;
  status: SessionStatus;
  lastActivity: string | null;
  lastEventKind: string | null;
  lastEventAt: string | null;
  lastReadAt: string | null;
};

type StarredProjectGroupPayload = {
  projectId: string | null;
  projectPath: string | null;
  displayName: string;
  sessions: StarredSessionPayload[];
};

function buildProjectDisplayName(
  customName: string | null,
  projectPath: string | null,
): string {
  if (customName && customName.trim().length > 0) {
    return customName;
  }
  if (!projectPath) {
    return 'Unknown project';
  }
  const normalized = normalizeProjectPath(projectPath);
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
}

function buildSessionTitle(customName: string | null, sessionId: string): string {
  if (customName && customName.trim().length > 0) {
    return customName;
  }
  return sessionId.length > 8 ? `${sessionId.slice(0, 8)}…` : sessionId;
}

function buildGroupedResponse(
  rows: import('@/modules/database/repositories/sessions.db.js').StarredSessionRow[],
): StarredProjectGroupPayload[] {
  const groupsByKey = new Map<string, StarredProjectGroupPayload>();
  for (const row of rows) {
    const status = deriveSessionStatus({
      lastEventKind: row.last_event_kind,
      lastEventAt: row.last_event_at,
      lastReadAt: row.last_read_at,
      updatedAt: row.updated_at,
    });
    const sessionPayload: StarredSessionPayload = {
      sessionId: row.session_id,
      provider: row.provider,
      title: buildSessionTitle(row.custom_name, row.session_id),
      status,
      lastActivity: row.last_user_message_at ?? row.updated_at ?? row.created_at ?? null,
      lastEventKind: row.last_event_kind,
      lastEventAt: row.last_event_at,
      lastReadAt: row.last_read_at,
    };
    const groupKey = row.project_id ?? row.project_path ?? `orphan:${row.session_id}`;
    const existing = groupsByKey.get(groupKey);
    if (existing) {
      existing.sessions.push(sessionPayload);
      continue;
    }
    groupsByKey.set(groupKey, {
      projectId: row.project_id ?? null,
      projectPath: row.project_path,
      displayName: buildProjectDisplayName(row.custom_project_name, row.project_path),
      sessions: [sessionPayload],
    });
  }
  return [...groupsByKey.values()];
}

router.post(
  '/:sessionId/toggle-star',
  asyncHandler(async (req, res) => {
    const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : '';
    const { isStarred } = toggleSessionStar(sessionId);
    res.json({ success: true, isStarred });
  }),
);

router.post(
  '/:sessionId/mark-read',
  asyncHandler(async (req, res) => {
    const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : '';
    sessionsDb.markSessionRead(sessionId);
    res.json({ success: true });
  }),
);

router.get(
  '/starred',
  asyncHandler(async (_req, res) => {
    const starredRows = sessionsDb.getStarredSessions();
    const recentRows = sessionsDb.getRecentSessions(24);

    res.json({
      projects: buildGroupedResponse(starredRows),
      recent: buildGroupedResponse(recentRows),
    });
  }),
);

export default router;
