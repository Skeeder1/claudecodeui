/**
 * Claude SDK Integration
 *
 * This module provides SDK-based integration with Claude using the @anthropic-ai/claude-agent-sdk.
 * It mirrors the interface of claude-cli.js but uses the SDK internally for better performance
 * and maintainability.
 *
 * Key features:
 * - Direct SDK integration without child processes
 * - Session management with abort capability
 * - Options mapping between CLI and SDK formats
 * - WebSocket message streaming
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CLAUDE_MODELS } from '../shared/modelConstants.js';
import { resolveClaudeCodeExecutablePath } from './shared/claude-cli-path.js';
import {
  createNotificationEvent,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled
} from './services/notification-orchestrator.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { createNormalizedMessage } from './shared/utils.js';

const activeSessions = new Map();

/**
 * Maps CLI options to SDK-compatible options format
 * @param {Object} options - CLI options
 * @returns {Object} SDK-compatible options
 */
function mapCliOptionsToSDK(options = {}) {
  const { sessionId, cwd } = options;

  const sdkOptions = {};

  // Forward all host env vars (e.g. ANTHROPIC_BASE_URL) to the subprocess.
  // Since SDK 0.2.113, options.env replaces process.env instead of overlaying it.
  // CLAUDE_CODE_ENTRYPOINT=cli: the SDK only sets this when not already defined
  // (see sdk.mjs: `if (!env.CLAUDE_CODE_ENTRYPOINT) env.CLAUDE_CODE_ENTRYPOINT = "sdk-ts"`).
  // Pre-setting it to 'cli' routes billing to Pool 1 (subscription) instead of Pool 2 (API credits).
  sdkOptions.env = { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'cli' };

  // Resolve the executable eagerly on Windows because the SDK uses raw child_process.spawn,
  // which does not reliably follow npm's shell wrappers like cross-spawn does.
  sdkOptions.pathToClaudeCodeExecutable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);

  if (cwd) {
    sdkOptions.cwd = cwd;
  }

  // Permission management is delegated entirely to the Claude Code SDK/CLI.
  // We always bypass the UI permission flow — no canUseTool callback, no 60s timeout.
  sdkOptions.permissionMode = 'bypassPermissions';

  // Use the tools preset to make all default built-in tools available.
  sdkOptions.tools = { type: 'preset', preset: 'claude_code' };

  sdkOptions.model = options.model || CLAUDE_MODELS.DEFAULT;

  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code'  // Required to use CLAUDE.md
  };

  // Loads CLAUDE.md from project, user, and local directories.
  sdkOptions.settingSources = ['project', 'user', 'local'];

  if (sessionId) {
    sdkOptions.resume = sessionId;
  }

  return sdkOptions;
}

/**
 * Discovers SDK-exposed slash commands, agents, and MCP servers for a session
 * and broadcasts them to the connected client. Called once per session after
 * the SDK becomes interactive. The SDK control methods used here are only
 * available on an active query instance — see sdk.d.ts:1878-1958.
 *
 * Each capability is fetched independently so a partial failure doesn't block
 * the others (e.g., older SDK versions without mcpServerStatus still send commands).
 *
 * @param {Object} queryInstance - Active SDK Query instance
 * @param {Object} ws - WebSocket writer for the client
 * @param {string} sessionId - The active session ID
 */
async function discoverSdkCapabilities(queryInstance, ws, sessionId) {
  if (!queryInstance) return;

  const fetchOrNull = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      console.warn(`[claude-sdk] discovery: ${label} failed:`, err?.message || err);
      return null;
    }
  };

  const [commands, agents, mcpServers] = await Promise.all([
    fetchOrNull('supportedCommands', () => queryInstance.supportedCommands?.()),
    fetchOrNull('supportedAgents',   () => queryInstance.supportedAgents?.()),
    fetchOrNull('mcpServerStatus',   () => queryInstance.mcpServerStatus?.()),
  ]);

  if (!commands && !agents && !mcpServers) return;

  ws.send({
    type: 'sdk-capabilities',
    sessionId,
    provider: 'claude',
    commands: commands || [],
    agents: agents || [],
    mcpServers: mcpServers || [],
  });
}

/**
 * Bridge for SDK control-request methods. Invoked by the chat WS handler when
 * the user runs a command that maps to a Query control method (interrupt,
 * setModel, setPermissionMode, etc). Keeping this as a single switch means
 * adding support for a new SDK method is a one-line change.
 *
 * @param {string} sessionId - Target session
 * @param {string} action    - Method name (e.g. 'interrupt', 'setModel')
 * @param {Object} args      - Action-specific arguments
 * @returns {Promise<{ok: boolean, result?: any, error?: string}>}
 */
async function executeSdkBridge(sessionId, action, args = {}) {
  const session = activeSessions.get(sessionId);
  if (!session || !session.instance) {
    return { ok: false, error: 'session_not_found' };
  }

  const q = session.instance;
  try {
    switch (action) {
      case 'interrupt':
        await q.interrupt();
        return { ok: true };
      case 'setModel':
        await q.setModel(args.model);
        return { ok: true, result: { model: args.model ?? null } };
      case 'setPermissionMode':
        await q.setPermissionMode(args.mode);
        return { ok: true, result: { mode: args.mode } };
      case 'getContextUsage': {
        const usage = await q.getContextUsage?.();
        return { ok: true, result: usage };
      }
      case 'supportedAgents': {
        const list = await q.supportedAgents?.();
        return { ok: true, result: list };
      }
      case 'mcpServerStatus': {
        const list = await q.mcpServerStatus?.();
        return { ok: true, result: list };
      }
      default:
        return { ok: false, error: `unknown_action:${action}` };
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {Object} queryInstance - SDK query instance
 * @param {Array<string>} tempImagePaths - Temp image file paths for cleanup
 * @param {string} tempDir - Temp directory for cleanup
 */
function addSession(sessionId, queryInstance, tempImagePaths = [], tempDir = null, writer = null) {
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: Date.now(),
    status: 'active',
    tempImagePaths,
    tempDir,
    writer
  });
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

/**
 * Gets all active session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getAllSessions() {
  return Array.from(activeSessions.keys());
}

/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 */
function transformMessage(sdkMessage) {
  // Extract parent_tool_use_id for subagent tool grouping
  if (sdkMessage.parent_tool_use_id) {
    return {
      ...sdkMessage,
      parentToolUseId: sdkMessage.parent_tool_use_id
    };
  }
  return sdkMessage;
}

/**
 * Extracts token usage from SDK result messages
 * @param {Object} resultMessage - SDK result message
 * @returns {Object|null} Token budget object or null
 */
function extractTokenBudget(resultMessage) {
  if (resultMessage.type !== 'result' || !resultMessage.modelUsage) {
    return null;
  }

  // Get the first model's usage data
  const modelKey = Object.keys(resultMessage.modelUsage)[0];
  const modelData = resultMessage.modelUsage[modelKey];

  if (!modelData) {
    return null;
  }

  // Use cumulative tokens if available (tracks total for the session)
  // Otherwise fall back to per-request tokens
  const inputTokens = modelData.cumulativeInputTokens || modelData.inputTokens || 0;
  const outputTokens = modelData.cumulativeOutputTokens || modelData.outputTokens || 0;
  const cacheReadTokens = modelData.cumulativeCacheReadInputTokens || modelData.cacheReadInputTokens || 0;
  const cacheCreationTokens = modelData.cumulativeCacheCreationInputTokens || modelData.cacheCreationInputTokens || 0;

  // Total used = input + output + cache tokens
  const totalUsed = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;

  // Use configured context window budget from environment (default 160000)
  // This is the user's budget limit, not the model's context window
  const contextWindow = parseInt(process.env.CONTEXT_WINDOW) || 160000;

  // Token calc logged via token-budget WS event

  return {
    used: totalUsed,
    total: contextWindow
  };
}

/**
 * Handles image processing for SDK queries
 * Saves base64 images to temporary files and returns modified prompt with file paths
 * @param {string} command - Original user prompt
 * @param {Array} images - Array of image objects with base64 data
 * @param {string} cwd - Working directory for temp file creation
 * @returns {Promise<Object>} {modifiedCommand, tempImagePaths, tempDir}
 */
async function handleImages(command, images, cwd) {
  const tempImagePaths = [];
  let tempDir = null;

  if (!images || images.length === 0) {
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }

  try {
    // Create temp directory in the project directory
    const workingDir = cwd || process.cwd();
    tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    // Save each image to a temp file
    for (const [index, image] of images.entries()) {
      // Extract base64 data and mime type
      const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        console.error('Invalid image data format');
        continue;
      }

      const [, mimeType, base64Data] = matches;
      const extension = mimeType.split('/')[1] || 'png';
      const filename = `image_${index}.${extension}`;
      const filepath = path.join(tempDir, filename);

      // Write base64 data to file
      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempImagePaths.push(filepath);
    }

    // Include the full image paths in the prompt
    let modifiedCommand = command;
    if (tempImagePaths.length > 0 && command && command.trim()) {
      const imageNote = `\n\n[Images provided at the following paths:]\n${tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
      modifiedCommand = command + imageNote;
    }

    // Images processed
    return { modifiedCommand, tempImagePaths, tempDir };
  } catch (error) {
    console.error('Error processing images for SDK:', error);
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }
}

/**
 * Cleans up temporary image files
 * @param {Array<string>} tempImagePaths - Array of temp file paths to delete
 * @param {string} tempDir - Temp directory to remove
 */
async function cleanupTempFiles(tempImagePaths, tempDir) {
  if (!tempImagePaths || tempImagePaths.length === 0) {
    return;
  }

  try {
    // Delete individual temp files
    for (const imagePath of tempImagePaths) {
      await fs.unlink(imagePath).catch(err =>
        console.error(`Failed to delete temp image ${imagePath}:`, err)
      );
    }

    // Delete temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(err =>
        console.error(`Failed to delete temp directory ${tempDir}:`, err)
      );
    }

    // Temp files cleaned
  } catch (error) {
    console.error('Error during temp file cleanup:', error);
  }
}

/**
 * Loads MCP server configurations from ~/.claude.json
 * @param {string} cwd - Current working directory for project-specific configs
 * @returns {Object|null} MCP servers object or null if none found
 */
async function loadMcpConfig(cwd) {
  try {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    // Check if config file exists
    try {
      await fs.access(claudeConfigPath);
    } catch (error) {
      // File doesn't exist, return null
      // No config file
      return null;
    }

    // Read and parse config file
    let claudeConfig;
    try {
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      claudeConfig = JSON.parse(configContent);
    } catch (error) {
      console.error('Failed to parse ~/.claude.json:', error.message);
      return null;
    }

    // Extract MCP servers (merge global and project-specific)
    let mcpServers = {};

    // Add global MCP servers
    if (claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object') {
      mcpServers = { ...claudeConfig.mcpServers };
      // Global MCP servers loaded
    }

    // Add/override with project-specific MCP servers
    if (claudeConfig.claudeProjects && cwd) {
      const projectConfig = claudeConfig.claudeProjects[cwd];
      if (projectConfig && projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
        mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
        // Project MCP servers merged
      }
    }

    // Return null if no servers found
    if (Object.keys(mcpServers).length === 0) {
      return null;
    }
    return mcpServers;
  } catch (error) {
    console.error('Error loading MCP config:', error.message);
    return null;
  }
}

/**
 * Executes a Claude query using the SDK
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function queryClaudeSDK(command, options = {}, ws) {
  const { sessionId, sessionSummary } = options;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let tempImagePaths = [];
  let tempDir = null;
  const t0 = Date.now();

  const emitNotification = (event) => {
    notifyUserIfEnabled({
      userId: ws?.userId || null,
      writer: ws,
      event
    });
  };

  // Send a progress phase message visible in the chat UI and server logs.
  const sendPhase = (phase, text, extra = {}) => {
    const elapsed = Date.now() - t0;
    console.log(`[claude-sdk] [${capturedSessionId || sessionId || 'NEW'}] ${phase} (+${elapsed}ms) — ${text}`);
    try {
      ws.send(createNormalizedMessage({
        kind: 'status',
        phase,
        text,
        sessionId: capturedSessionId || sessionId || null,
        provider: 'claude',
        canInterrupt: false,
        ...extra,
      }));
    } catch (_) { /* ws may be closed */ }
  };

  try {
    console.log(`[claude-sdk] queryClaudeSDK START — sessionId: ${sessionId || 'NEW'}, model: ${options.model || 'default'}, cwd: ${options.cwd || '(none)'}`);
    sendPhase('init', 'Starting query...');

    // Map CLI options to SDK format
    const sdkOptions = mapCliOptionsToSDK(options);

    // NOTE: mcpServers are intentionally NOT loaded here.
    // sdkOptions.settingSources = ['project', 'user', 'local'] already instructs
    // the claude CLI subprocess to read ~/.claude.json (user source) which includes
    // all global MCP servers. Passing them again via sdkOptions.mcpServers would
    // cause every server to be started twice, adding 20–60s of startup time per query.

    // Handle images - save to temp files and modify prompt
    const imageResult = await handleImages(command, options.images, options.cwd);
    const finalCommand = imageResult.modifiedCommand;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    sdkOptions.hooks = {
      Notification: [{
        matcher: '',
        hooks: [async (input) => {
          const message = typeof input?.message === 'string' ? input.message : 'Claude requires your attention.';
          emitNotification(createNotificationEvent({
            provider: 'claude',
            sessionId: capturedSessionId || sessionId || null,
            kind: 'action_required',
            code: 'agent.notification',
            meta: { message, sessionName: sessionSummary },
            severity: 'warning',
            requiresUserAction: true,
            dedupeKey: `claude:hook:notification:${capturedSessionId || sessionId || 'none'}:${message}`
          }));
          return {};
        }]
      }]
    };

    // Permissions are fully delegated to the Claude Code SDK/CLI via permissionMode:
    // 'bypassPermissions'. No canUseTool callback is registered, so no UI prompt or
    // 60s auto-deny is possible. The SDK handles tool execution natively.

    // Set stream-close timeout for interactive tools (Query constructor reads it synchronously). Claude Agent SDK has a default of 5s and this overrides it
    const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

    let queryInstance;
    try {
      queryInstance = query({
        prompt: finalCommand,
        options: sdkOptions
      });
    } catch (hookError) {
      // Older/newer SDK versions may not accept hook shapes yet.
      // Keep notification behavior operational via runtime events even if hook registration fails.
      console.warn('Failed to initialize Claude query with hooks, retrying without hooks:', hookError?.message || hookError);
      delete sdkOptions.hooks;
      queryInstance = query({
        prompt: finalCommand,
        options: sdkOptions
      });
    }

    // Restore immediately — Query constructor already captured the value
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }

    sendPhase('query_ready', 'Query initializing...');

    // Track the query instance for abort capability.
    // For resume sessions capturedSessionId is already known; register immediately.
    // For new sessions we use a temporary key so abort works during MCP startup,
    // before the first SDK message delivers the real session_id.
    const tempSessionKey = capturedSessionId || `pending_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    addSession(tempSessionKey, queryInstance, tempImagePaths, tempDir, ws);

    // Process streaming messages
    let firstMessage = true;
    for await (const message of queryInstance) {
      if (firstMessage) {
        firstMessage = false;
        sendPhase('streaming', 'Streaming response...');
        console.log(`[claude-sdk] [${capturedSessionId || 'NEW'}] first message received (+${Date.now() - t0}ms)`);
      }

      // Capture session ID from first message
      if (message.session_id && (!capturedSessionId || capturedSessionId === tempSessionKey)) {
        const prevKey = capturedSessionId || tempSessionKey;
        capturedSessionId = message.session_id;

        // Migrate from temp key to real session ID
        if (prevKey !== capturedSessionId) {
          removeSession(prevKey);
          addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir, ws);
        }

        // Set session ID on writer
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }

        // Send session-created event only once for new sessions
        if (!sessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'claude' }));
        }

        // Discover SDK-native slash commands once per session, broadcast to client.
        // The SDK auto-includes commands from MCP plugins, agents, and built-in features —
        // this gives the slash menu zero-maintenance growth as the SDK evolves.
        discoverSdkCapabilities(queryInstance, ws, capturedSessionId).catch((err) => {
          console.warn('[claude-sdk] SDK capability discovery failed:', err?.message || err);
        });
      }

      // Transform and normalize message via adapter
      const transformedMessage = transformMessage(message);
      const sid = capturedSessionId || sessionId || null;

      // Use adapter to normalize SDK events into NormalizedMessage[]
      const normalized = sessionsService.normalizeMessage('claude', transformedMessage, sid);
      for (const msg of normalized) {
        // Preserve parentToolUseId from SDK wrapper for subagent tool grouping
        if (transformedMessage.parentToolUseId && !msg.parentToolUseId) {
          msg.parentToolUseId = transformedMessage.parentToolUseId;
        }
        ws.send(msg);
      }

      // Extract and send token budget updates from result messages
      if (message.type === 'result') {
        const models = Object.keys(message.modelUsage || {});
        if (models.length > 0) {
          // Model info available in result message
        }
        const tokenBudgetData = extractTokenBudget(message);
        if (tokenBudgetData) {
          ws.send(createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: tokenBudgetData, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }
      }
    }

    // Clean up session on completion (remove whichever key is still registered)
    removeSession(capturedSessionId || tempSessionKey);

    // Clean up temporary image files
    await cleanupTempFiles(tempImagePaths, tempDir);

    console.log(`[claude-sdk] [${capturedSessionId || 'NEW'}] complete (+${Date.now() - t0}ms)`);

    // Send completion event
    ws.send(createNormalizedMessage({ kind: 'complete', exitCode: 0, isNewSession: !sessionId && !!command, sessionId: capturedSessionId, provider: 'claude' }));
    notifyRunStopped({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      stopReason: 'completed'
    });

  } catch (error) {
    console.error(`[claude-sdk] [${capturedSessionId || 'NEW'}] ERROR (+${Date.now() - t0}ms):`, error.message || error);

    // Clean up session on error (remove whichever key is still registered)
    removeSession(capturedSessionId || tempSessionKey);

    // Clean up temporary image files on error
    await cleanupTempFiles(tempImagePaths, tempDir);

    // Check if Claude CLI is installed for a clearer error message
    const installed = await providerAuthService.isProviderInstalled('claude');
    const errorContent = !installed
      ? 'Claude Code is not installed. Please install it first: https://docs.anthropic.com/en/docs/claude-code'
      : error.message;

    // Send error to WebSocket
    ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
    notifyRunFailed({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      error
    });
  }
}

/**
 * Aborts an active SDK session.
 * Falls back to the most-recently-started pending session when sessionId is unknown
 * (new sessions whose real session_id hasn't been delivered yet).
 * @param {string} sessionId - Session identifier (may be empty for in-flight new sessions)
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortClaudeSDKSession(sessionId) {
  let session = getSession(sessionId);
  let resolvedKey = sessionId;

  // For new sessions the frontend sends an empty/null sessionId because the
  // real ID hasn't been returned yet. Fall back to the most-recent pending key.
  if (!session) {
    const pendingKey = Array.from(activeSessions.keys())
      .filter(k => k.startsWith('pending_'))
      .sort()
      .at(-1);

    if (pendingKey) {
      session = getSession(pendingKey);
      resolvedKey = pendingKey;
    }
  }

  if (!session) {
    console.log(`[claude-sdk] abort: session not found (sessionId=${sessionId || 'empty'})`);
    return false;
  }

  try {
    console.log(`[claude-sdk] aborting session: ${resolvedKey}`);

    // Call interrupt() on the query instance
    await session.instance.interrupt();

    // Update session status
    session.status = 'aborted';

    // Clean up temporary image files
    await cleanupTempFiles(session.tempImagePaths, session.tempDir);

    // Clean up session
    removeSession(resolvedKey);

    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Checks if an SDK session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
function isClaudeSDKSessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

/**
 * Gets all active SDK session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveClaudeSDKSessions() {
  return getAllSessions();
}

/**
 * Reconnect a session's WebSocketWriter to a new raw WebSocket.
 * Called when client reconnects (e.g. page refresh) while SDK is still running.
 * @param {string} sessionId - The session ID
 * @param {Object} newRawWs - The new raw WebSocket connection
 * @returns {boolean} True if writer was successfully reconnected
 */
function reconnectSessionWriter(sessionId, newRawWs) {
  const session = getSession(sessionId);
  if (!session?.writer?.updateWebSocket) return false;
  session.writer.updateWebSocket(newRawWs);
  console.log(`[RECONNECT] Writer swapped for session ${sessionId}`);
  return true;
}

// Export public API
export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  reconnectSessionWriter,
  executeSdkBridge
};
