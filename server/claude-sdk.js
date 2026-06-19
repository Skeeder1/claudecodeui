import { query } from '@anthropic-ai/claude-agent-sdk';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import os from 'os';
import { CLAUDE_FALLBACK_MODELS } from './modules/providers/list/claude/claude-models.provider.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
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

// Permission modes selectable from the UI.
//   - 'plan'              : no tool execution, produces a plan
//   - 'auto'              : SDK model-classifier auto-approves safe tools and
//                           escalates risky ones to our canUseTool callback
//   - 'bypassPermissions' : run everything, no prompts
const UI_PERMISSION_MODES = new Set(['plan', 'auto', 'bypassPermissions']);

// Human-in-the-loop tool approvals awaiting a user decision, keyed by requestId.
// The interactive approval flow was removed in c63a10d and rebuilt here: it now
// waits INDEFINITELY (no 60s auto-deny) and survives WebSocket reconnects so the
// user can approve later by re-opening the app. "Always allow" is persisted
// NATIVELY in Claude Code settings via the SDK's updatedPermissions (not a layer
// on top of the CLI).
const pendingToolApprovals = new Map();

function createRequestId() {
  try {
    return randomUUID();
  } catch {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

// Resolves only on an explicit user decision (resolveToolApproval) or a session
// abort (context.signal). There is intentionally NO timer: the request waits
// indefinitely so a closed app can be re-opened and the prompt answered.
function waitForToolApproval(requestId, options = {}) {
  const { signal, onCancel, metadata } = options;

  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      pendingToolApprovals.delete(requestId);
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    const finalize = (decision) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(decision);
    };

    const abortHandler = () => {
      onCancel?.('cancelled');
      finalize({ cancelled: true });
    };

    if (signal) {
      if (signal.aborted) {
        onCancel?.('cancelled');
        finalize({ cancelled: true });
        return;
      }
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const resolver = (decision) => finalize(decision);
    if (metadata) {
      Object.assign(resolver, metadata);
    }
    pendingToolApprovals.set(requestId, resolver);
  });
}

// Called from the WebSocket layer when the user clicks Accept / Always / Deny.
function resolveToolApproval(requestId, decision) {
  const resolver = pendingToolApprovals.get(requestId);
  if (!resolver) return false;
  resolver(decision);
  return true;
}

// Used on reconnect to re-emit any still-pending prompts to the freshly
// reconnected client (#462 behaviour, rebuilt).
function getPendingApprovalsForSession(sessionId) {
  const pending = [];
  for (const [requestId, resolver] of pendingToolApprovals.entries()) {
    if (resolver._sessionId === sessionId) {
      pending.push({
        requestId,
        toolName: resolver._toolName || 'UnknownTool',
        input: resolver._input,
        suggestions: resolver._suggestions,
        title: resolver._title,
        description: resolver._description,
        sessionId,
        receivedAt: resolver._receivedAt || new Date(),
      });
    }
  }
  return pending;
}

// Derives a native Claude Code permission rule from a tool call so that
// "Always allow" can be persisted as a real settings.json rule. Bash keeps a
// command prefix (two words for git/npm-style multi-verb CLIs), other tools use
// the bare tool name.
function buildPermissionRule(toolName, input) {
  if (toolName === 'Bash') {
    let command = '';
    if (typeof input === 'string') {
      command = input.trim();
    } else if (input && typeof input === 'object' && typeof input.command === 'string') {
      command = input.command.trim();
    }
    const tokens = command.split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      const TWO_WORD_CLIS = new Set(['git', 'npm', 'pnpm', 'yarn', 'docker', 'cargo', 'go', 'kubectl', 'sudo']);
      const prefix = (TWO_WORD_CLIS.has(tokens[0]) && tokens[1]) ? `${tokens[0]} ${tokens[1]}` : tokens[0];
      return { toolName: 'Bash', ruleContent: `${prefix}:*` };
    }
  }
  return { toolName };
}

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

  // Permission mode comes from the UI selector. Only the modes that work without
  // an interactive approval UI are allowed (the permission-prompt UI was removed):
  //   - 'plan'              : no tool execution, produces a plan
  //   - 'auto'              : SDK model-classifier decides approvals
  //   - 'bypassPermissions' : run everything, no prompts (default fallback)
  // Any unknown/unsafe value falls back to 'bypassPermissions'.
  // NOTE: billing stays on the subscription pool via CLAUDE_CODE_ENTRYPOINT=cli
  // (set above) + the logged-in CLI binary — permissionMode does not affect that.
  sdkOptions.permissionMode = UI_PERMISSION_MODES.has(options.permissionMode)
    ? options.permissionMode
    : 'bypassPermissions';

  // Use the tools preset to make all default built-in tools available.
  sdkOptions.tools = { type: 'preset', preset: 'claude_code' };

  // `settings` no longer exists since the permission UI was removed; source
  // disallowedTools from the caller options (defaulting to none) to avoid a
  // ReferenceError that aborted every Claude message send.
  sdkOptions.disallowedTools = options.disallowedTools || [];

  // Map model (default to sonnet)
  // Valid models: sonnet, opus, haiku, opusplan, sonnet[1m]
  sdkOptions.model = options.model || CLAUDE_FALLBACK_MODELS.DEFAULT;
  // Model logged at query start below

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

// SDK control methods only exist on an active query instance; each capability fetched independently so partial failure (older SDK) doesn't block others.
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

// Single-switch bridge so adding a new SDK control method is a one-line change.
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

function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

function getAllSessions() {
  return Array.from(activeSessions.keys());
}

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

function readNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Prefers per-step message.usage; falls back to modelUsage for compatibility across SDK versions.
function extractTokenBudget(sdkMessage) {
  if (!sdkMessage || typeof sdkMessage !== 'object') {
    return null;
  }

  const messageUsage = sdkMessage.message?.usage || sdkMessage.usage;
  if (messageUsage && typeof messageUsage === 'object') {
    const inputTokens = readNumber(messageUsage.input_tokens ?? messageUsage.inputTokens);
    const outputTokens = readNumber(messageUsage.output_tokens ?? messageUsage.outputTokens);
    const totalUsed = inputTokens + outputTokens;
    const contextWindow = parseInt(process.env.CONTEXT_WINDOW, 10) || 160000;

    return {
      used: totalUsed,
      total: contextWindow,
      inputTokens,
      outputTokens,
      breakdown: {
        input: inputTokens,
        output: outputTokens,
      },
    };
  }

  if (!sdkMessage.modelUsage || typeof sdkMessage.modelUsage !== 'object') {
    return null;
  }

  // Fallback for older SDK messages with only modelUsage
  const modelKey = Object.keys(sdkMessage.modelUsage)[0];
  const modelData = sdkMessage.modelUsage[modelKey];

  if (!modelData || typeof modelData !== 'object') {
    return null;
  }

  const inputTokens = readNumber(modelData.cumulativeInputTokens ?? modelData.inputTokens);
  const outputTokens = readNumber(modelData.cumulativeOutputTokens ?? modelData.outputTokens);
  const totalUsed = inputTokens + outputTokens;
  const contextWindow = parseInt(process.env.CONTEXT_WINDOW, 10) || 160000;

  return {
    used: totalUsed,
    total: contextWindow,
    inputTokens,
    outputTokens,
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
  };
}

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
    const resolvedModel = await providerModelsService.resolveResumeModel(
      'claude',
      sessionId,
      options.model,
    );
    sendPhase('init', 'Starting query...');

    // Map CLI options to SDK format
    const sdkOptions = mapCliOptionsToSDK({
      ...options,
      model: resolvedModel || options.model,
    });

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

    // Human-in-the-loop tool approval. Registered for every mode but short-circuits
    // to allow under bypassPermissions so that mode stays prompt-free. In 'auto'
    // (and 'default') the SDK only invokes this for tools its classifier cannot
    // safely auto-approve, so safe commands run silently and risky ones WAIT HERE —
    // indefinitely — until the user clicks Accept / Always / Deny. This replaces the
    // old 60s auto-deny that silently killed sessions.
    sdkOptions.canUseTool = async (toolName, input, context) => {
      if (sdkOptions.permissionMode === 'bypassPermissions') {
        return { behavior: 'allow', updatedInput: input };
      }

      const reqSessionId = capturedSessionId || sessionId || null;
      const requestId = createRequestId();
      const suggestions = Array.isArray(context?.suggestions) ? context.suggestions : [];
      const title = typeof context?.title === 'string' ? context.title : undefined;
      const description = typeof context?.description === 'string' ? context.description : undefined;

      ws.send(createNormalizedMessage({
        kind: 'permission_request',
        requestId,
        toolName,
        input,
        suggestions,
        title,
        description,
        sessionId: reqSessionId,
        provider: 'claude',
      }));

      emitNotification(createNotificationEvent({
        provider: 'claude',
        sessionId: reqSessionId,
        kind: 'action_required',
        code: 'permission.required',
        meta: { toolName, sessionName: sessionSummary },
        severity: 'warning',
        requiresUserAction: true,
        dedupeKey: `claude:permission:${reqSessionId || 'none'}:${requestId}`
      }));

      const decision = await waitForToolApproval(requestId, {
        signal: context?.signal,
        metadata: {
          _sessionId: reqSessionId,
          _toolName: toolName,
          _input: input,
          _suggestions: suggestions,
          _title: title,
          _description: description,
          _receivedAt: new Date(),
        },
        onCancel: (reason) => {
          ws.send(createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason, sessionId: reqSessionId, provider: 'claude' }));
        }
      });

      if (!decision || decision.cancelled) {
        return { behavior: 'deny', message: 'Permission request cancelled' };
      }

      if (decision.allow) {
        // "Always allow" → persist the rule NATIVELY in Claude Code settings via the
        // SDK's updatedPermissions (written to .claude/settings.json), not a CloudCLI
        // layer. Prefer the SDK's own suggestions; fall back to a derived rule.
        if (decision.always) {
          const updatedPermissions = suggestions.length > 0
            ? suggestions.map((update) => ({ ...update, destination: 'projectSettings' }))
            : [{ type: 'addRules', rules: [buildPermissionRule(toolName, input)], behavior: 'allow', destination: 'projectSettings' }];
          return { behavior: 'allow', updatedInput: input, updatedPermissions };
        }
        return { behavior: 'allow', updatedInput: input };
      }

      return { behavior: 'deny', message: typeof decision.message === 'string' ? decision.message : 'User denied tool use' };
    };

    // Stream-close timeout: while a permission can be pending (any non-bypass mode)
    // keep the turn open effectively forever so a pending approval survives an idle
    // app/closed tab. Bypass mode keeps the prior 5-minute value. Query constructor
    // reads this synchronously (SDK default is 5s).
    const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT =
      sdkOptions.permissionMode === 'bypassPermissions' ? '300000' : '2147483647';

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

      // Forward the SDK's real permission mode so the UI badge reflects reality.
      // System 'init' announces the active mode; 'status' announces mid-session
      // changes (e.g. the SDK leaving plan mode after ExitPlanMode).
      if (message.type === 'system' && typeof message.permissionMode === 'string') {
        ws.send(createNormalizedMessage({
          kind: 'status',
          text: 'permission_mode',
          permissionMode: message.permissionMode,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'claude',
        }));
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

      // Extract and send token budget updates from assistant/result usage payloads
      const tokenBudgetData = extractTokenBudget(message);
      if (tokenBudgetData) {
        ws.send(createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: tokenBudgetData, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
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
      // Never send an empty content: non-Error throws have no `.message`, which
      // would render as the bare "Unknown error" fallback in the chat UI.
      : (error?.message || String(error) || 'Unknown error (no details)');

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

// Falls back to the most-recently-started pending key when the real session_id hasn't arrived yet (in-flight new sessions).
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

function isClaudeSDKSessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

function getActiveClaudeSDKSessions() {
  return getAllSessions();
}

async function abortAllClaudeSDKSessions(timeoutMs = 3000) {
  const keys = getAllSessions();
  const results = await Promise.allSettled(
    keys.map((sessionId) =>
      Promise.race([
        abortClaudeSDKSession(sessionId),
        new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
      ])
    )
  );
  // Force-destroy any remaining instance that didn't respond to interrupt()
  for (const sessionId of keys) {
    const session = getSession(sessionId);
    if (session?.instance?.destroy) {
      try { session.instance.destroy(); } catch { }
      removeSession(sessionId);
    }
  }
  return results.filter((r) => r.status === 'fulfilled' && r.value).length;
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
  abortAllClaudeSDKSessions,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  reconnectSessionWriter,
  resolveToolApproval,
  getPendingApprovalsForSession,
  executeSdkBridge
};
