export type LLMProvider = 'claude' | 'cursor' | 'codex' | 'gemini' | 'opencode';

export type ProviderModelOption = {
  value: string;
  label: string;
  description?: string;
};

export type ProviderModelsDefinition = {
  OPTIONS: ProviderModelOption[];
  DEFAULT: string;
};

export type ProviderModelsCacheInfo = {
  updatedAt: string;
  expiresAt: string;
  source: 'memory' | 'disk' | 'fresh';
};

export type AppTab = 'chat' | 'files' | 'shell' | 'git' | 'tasks' | 'preview' | `plugin:${string}`;

export type ProjectSession = {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  __provider?: LLMProvider;
  // Tags the session with the owning project's DB `projectId` so UI handlers
  // (session switching, sidebar focus, etc.) can match against selectedProject.
  __projectId?: string;
  [key: string]: unknown;
}

export type ProjectSessionMeta = {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export type ProjectTaskmasterInfo = {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

// After the projectName → projectId migration the backend no longer returns a
// folder-derived `name` string. Projects are now addressed everywhere by the
// DB-assigned `projectId` (primary key in the `projects` table), and the UI
// uses the same identifier for routing, state keys and API calls.
export type Project = {
  projectId: string;
  displayName: string;
  fullPath: string;
  path?: string;
  isStarred?: boolean;
  sessions?: ProjectSession[];
  cursorSessions?: ProjectSession[];
  codexSessions?: ProjectSession[];
  geminiSessions?: ProjectSession[];
  opencodeSessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  taskmaster?: ProjectTaskmasterInfo;
  [key: string]: unknown;
}

export type LoadingProgress = {
  type?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
};

export type ProjectsUpdatedMessage = {
  type: 'projects_updated';
  projects: Project[];
  updatedSessionId?: string;
  updatedSessionIds?: string[];
  watchProvider?: LLMProvider;
  watchProviders?: LLMProvider[];
  changeType?: 'add' | 'change';
  changeTypes?: Array<'add' | 'change'>;
  batched?: boolean;
  [key: string]: unknown;
}

export type LoadingProgressMessage = LoadingProgress & {
  type: 'loading_progress';
};

export type AppSocketMessage =
  | LoadingProgressMessage
  | ProjectsUpdatedMessage
  | { type?: string;[key: string]: unknown };

export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
};

export type ApiErrorResponse = {
  success: false;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export type ReleaseInfo = {
  title: string;
  body: string;
  htmlUrl: string;
  publishedAt: string;
};
