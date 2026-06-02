import type { Project, ProjectSession, LLMProvider } from '../../../types/app';

export type Provider = LLMProvider;

export type ChatImage = {
  data: string;
  name: string;
}

export type ToolResult = {
  content?: unknown;
  isError?: boolean;
  timestamp?: string | number | Date;
  toolUseResult?: unknown;
  [key: string]: unknown;
}

export type SubagentChildTool = {
  toolId: string;
  toolName: string;
  toolInput: unknown;
  toolResult?: ToolResult | null;
  timestamp: Date;
}

export type ChatMessage = {
  type: string;
  content?: string;
  displayText?: string;
  timestamp: string | number | Date;
  images?: ChatImage[];
  reasoning?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  isInteractivePrompt?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  toolId?: string;
  toolCallId?: string;
  commandName?: string;
  commandMessage?: string;
  commandArgs?: string;
  isLocalCommand?: boolean;
  isLocalCommandStdout?: boolean;
  isCompactSummary?: boolean;
  isSubagentContainer?: boolean;
  subagentState?: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
  [key: string]: unknown;
}

export type QuestionOption = {
  label: string;
  description?: string;
}

export type Question = {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export type SessionNavigationOptions = {
  replace?: boolean;
};

export type ChatInterfaceProps = {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  latestMessage: unknown;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onSessionActive?: (sessionId?: string | null) => void;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  processingSessions?: Set<string>;
  onNavigateToSession?: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  onShowSettings?: () => void;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  autoScrollToBottom?: boolean;
  sendByCtrlEnter?: boolean;
  externalMessageUpdate?: number;
  newSessionTrigger?: number;
  onTaskClick?: (...args: unknown[]) => void;
  onShowAllTasks?: (() => void) | null;
}
