import { getConnection } from '@/modules/database/connection.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { normalizeProjectPath } from '@/shared/utils.js';

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

type SessionMetadataLookupRow = Pick<
  SessionRow,
  | 'session_id'
  | 'provider'
  | 'project_path'
  | 'jsonl_path'
  | 'custom_name'
  | 'isArchived'
  | 'isStarred'
  | 'last_event_kind'
  | 'last_event_at'
  | 'last_read_at'
  | 'created_at'
  | 'updated_at'
  | 'last_user_message_at'
>;

export type StarredSessionRow = SessionRow & {
  project_id: string | null;
  custom_project_name: string | null;
};

const SESSION_COLUMNS = `session_id, provider, project_path, jsonl_path, custom_name, isArchived, isStarred, last_event_kind, last_event_at, last_read_at, created_at, updated_at, last_user_message_at`;

function normalizeTimestamp(value?: string): string | null {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeProjectPathForProvider(provider: string, projectPath: string): string {
  void provider;
  return normalizeProjectPath(projectPath);
}

export const sessionsDb = {
  createSession(
    sessionId: string,
    provider: string,
    projectPath: string,
    customName?: string,
    createdAt?: string,
    updatedAt?: string,
    jsonlPath?: string | null,
    lastUserMessageAt?: string | null
  ): string {
    const db = getConnection();
    const createdAtValue = normalizeTimestamp(createdAt);
    const updatedAtValue = normalizeTimestamp(updatedAt);
    const lastUserMessageAtValue = normalizeTimestamp(lastUserMessageAt ?? undefined);
    const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);

    // First, ensure the project path is recorded in the projects table,
    // since it's a foreign key in the sessions table.
    projectsDb.createProjectPath(normalizedProjectPath);

    db.prepare(
      `INSERT INTO sessions (session_id, provider, custom_name, project_path, jsonl_path, isArchived, created_at, updated_at, last_user_message_at)
       VALUES (?, ?, ?, ?, ?, 0, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP), ?)
       ON CONFLICT(session_id) DO UPDATE SET
         provider = excluded.provider,
         updated_at = excluded.updated_at,
         project_path = excluded.project_path,
         jsonl_path = excluded.jsonl_path,
         isArchived = 0,
         custom_name = COALESCE(excluded.custom_name, sessions.custom_name),
         last_user_message_at = COALESCE(excluded.last_user_message_at, sessions.last_user_message_at)`
    ).run(
      sessionId,
      provider,
      customName ?? null,
      normalizedProjectPath,
      jsonlPath ?? null,
      createdAtValue,
      updatedAtValue,
      lastUserMessageAtValue
    );

    return sessionId;
  },

  updateSessionCustomName(sessionId: string, customName: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET custom_name = ?
       WHERE session_id = ?`
    ).run(customName, sessionId);
  },

  getSessionById(sessionId: string): SessionMetadataLookupRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${SESSION_COLUMNS}
         FROM sessions
         WHERE session_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(sessionId) as SessionMetadataLookupRow | undefined;

    return row ?? null;
  },

  getAllSessions(): SessionRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${SESSION_COLUMNS}
         FROM sessions
         WHERE isArchived = 0`
      )
      .all() as SessionRow[];
  },

  /**
   * Archived rows are intentionally queried separately so the caller can render
   * them in a dedicated view without reintroducing them into active session lists.
   */
  getArchivedSessions(): SessionRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${SESSION_COLUMNS}
         FROM sessions
         WHERE isArchived = 1
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC`
      )
      .all() as SessionRow[];
  },

  getSessionsByProjectPath(projectPath: string): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    return db
      .prepare(
        `SELECT ${SESSION_COLUMNS}
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0`
      )
      .all(normalizedProjectPath) as SessionRow[];
  },

  /**
   * Permanent project deletion must see every session row for the path,
   * including archived ones, so their transcript files can be cleaned up.
   */
  getSessionsByProjectPathIncludingArchived(projectPath: string): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    return db
      .prepare(
        `SELECT ${SESSION_COLUMNS}
         FROM sessions
         WHERE project_path = ?`
      )
      .all(normalizedProjectPath) as SessionRow[];
  },

  getSessionsByProjectPathPage(projectPath: string, limit: number, offset: number): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    return db
      .prepare(
        `SELECT ${SESSION_COLUMNS}
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
         LIMIT ? OFFSET ?`
      )
      .all(normalizedProjectPath, limit, offset) as SessionRow[];
  },

  countSessionsByProjectPath(projectPath: string): number {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0`
      )
      .get(normalizedProjectPath) as { count: number } | undefined;

    return Number(row?.count ?? 0);
  },

  deleteSessionsByProjectPath(projectPath: string): void {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    db.prepare(`DELETE FROM sessions WHERE project_path = ?`).run(normalizedProjectPath);
  },

  getSessionName(sessionId: string, provider: string): string | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT custom_name
         FROM sessions
         WHERE session_id = ? AND provider = ?`
      )
      .get(sessionId, provider) as { custom_name: string | null } | undefined;

    return row?.custom_name ?? null;
  },

  /**
   * Soft-delete and restore both use the same flag update so callers keep the
   * row, metadata, and file path intact while toggling visibility.
   */
  updateSessionIsArchived(sessionId: string, isArchived: boolean): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET isArchived = ?
       WHERE session_id = ?`
    ).run(isArchived ? 1 : 0, sessionId);
  },

  deleteSessionById(sessionId: string): boolean {
    const db = getConnection();
    return db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId).changes > 0;
  },

  updateSessionIsStarred(sessionId: string, isStarred: boolean): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET isStarred = ?
       WHERE session_id = ?`
    ).run(isStarred ? 1 : 0, sessionId);
  },

  recordSessionEvent(sessionId: string, kind: string, occurredAt?: string | null): void {
    const db = getConnection();
    const normalized = normalizeTimestamp(occurredAt ?? undefined);
    db.prepare(
      `UPDATE sessions
       SET last_event_kind = ?,
           last_event_at = COALESCE(?, CURRENT_TIMESTAMP)
       WHERE session_id = ?`
    ).run(kind, normalized, sessionId);
  },

  markSessionRead(sessionId: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET last_read_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`
    ).run(sessionId);
  },

  /**
   * Returns active starred sessions joined with their project metadata so the
   * sidebar favorites view can group by project without a second query per row.
   */
  getStarredSessions(): StarredSessionRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT s.session_id, s.provider, s.project_path, s.jsonl_path, s.custom_name,
                s.isArchived, s.isStarred, s.last_event_kind, s.last_event_at, s.last_read_at,
                s.created_at, s.updated_at, s.last_user_message_at,
                p.project_id, p.custom_project_name
         FROM sessions s
         LEFT JOIN projects p ON p.project_path = s.project_path
         WHERE s.isStarred = 1 AND s.isArchived = 0
         ORDER BY datetime(COALESCE(s.last_user_message_at, s.updated_at, s.created_at)) DESC, s.session_id DESC`
      )
      .all() as StarredSessionRow[];
  },

  getRecentSessions(hours: number = 48): StarredSessionRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT s.session_id, s.provider, s.project_path, s.jsonl_path, s.custom_name,
                s.isArchived, s.isStarred, s.last_event_kind, s.last_event_at, s.last_read_at,
                s.created_at, s.updated_at, s.last_user_message_at,
                p.project_id, p.custom_project_name
         FROM sessions s
         LEFT JOIN projects p ON p.project_path = s.project_path
         WHERE s.isStarred = 0 AND s.isArchived = 0
           AND datetime(COALESCE(s.last_user_message_at, s.updated_at, s.created_at)) > datetime('now', '-${Math.max(1, hours)} hours')
         ORDER BY datetime(COALESCE(s.last_user_message_at, s.updated_at, s.created_at)) DESC, s.session_id DESC`
      )
      .all() as StarredSessionRow[];
  },
};
