/**
 * Claude PTY Bridge — Pool 1 billing path
 *
 * Replaces @anthropic-ai/claude-agent-sdk query() as the transport layer.
 *
 * Why PTY?
 *   Claude checks `!process.stdout.isTTY` at startup. When stdout is a pipe
 *   (regular child_process.spawn), isTTY=false → cc_entrypoint=sdk-cli → Pool 2.
 *   With node-pty, claude's stdout IS a TTY → cc_entrypoint=cli → Pool 1.
 *   Source: https://github.com/anthropics/claude-code/issues/59106
 *
 * Protocol:
 *   - No -p flag: claude runs in persistent streaming mode
 *   - --input-format stream-json: reads JSON user messages from stdin
 *   - --output-format stream-json: writes JSON events to stdout (NDJSON)
 *   - Bidirectional control protocol for interrupt, setModel, etc.
 *   Reference: open-claude-agent-sdk/src/core/control.ts (MIT)
 */

import pty from 'node-pty';
import { resolveClaudeCodeExecutablePath } from './shared/claude-cli-path.js';

// Control protocol wire constants
const T_CTRL_REQ  = 'control_request';
const T_CTRL_RESP = 'control_response';
const S_SUCCESS   = 'success';

let _seq = 0;
const genId = () => `req_${Date.now()}_${(++_seq).toString(36)}`;

/** Strip ANSI escape sequences from PTY output before JSON.parse */
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;

function stripAnsi(s) {
  return s.replace(ANSI_RE, '').replace(/\r/g, '').trim();
}

/**
 * Build the bash wrapper command.
 * `stty -echo` disables terminal echo so our stdin JSON doesn't pollute stdout.
 * `exec` replaces bash with claude, inheriting the PTY (isTTY stays true).
 */
function buildShellCmd(claudeExec, opts) {
  const args = [
    '--input-format stream-json',
    '--output-format stream-json',
    '--verbose',
    `--permission-mode ${opts.permissionMode ?? 'bypassPermissions'}`,
    '--setting-sources=project,user,local',
  ];
  // Safe: model is from CLAUDE_MODELS constant, sessionId is a UUID — no shell injection risk
  if (opts.model)     args.push(`--model '${opts.model}'`);
  if (opts.sessionId) args.push(`--resume '${opts.sessionId}'`);

  return `stty -echo; exec '${claudeExec}' ${args.join(' ')}`;
}

/**
 * Minimal async queue — decouples PTY data callback from async consumer.
 */
function makeQueue() {
  const items = [];
  const waiters = [];
  return {
    push(v) {
      waiters.length > 0 ? waiters.shift()(v) : items.push(v);
    },
    async shift() {
      return items.length > 0 ? items.shift() : new Promise(r => waiters.push(r));
    },
    drainWaiters(v) {
      while (waiters.length > 0) waiters.shift()(v);
    },
  };
}

/**
 * Create a PTY-based query, drop-in replacement for the SDK `query()` call.
 *
 * @param {string} prompt  - User message to send
 * @param {object} options - Options (model, sessionId, cwd, permissionMode, pathToClaudeCodeExecutable)
 * @returns AsyncIterable + control methods (interrupt, setModel, etc.)
 */
export function createPTYQuery(prompt, options = {}) {
  const claudeExec = resolveClaudeCodeExecutablePath(
    options.pathToClaudeCodeExecutable ?? process.env.CLAUDE_CLI_PATH
  );
  const shellCmd = buildShellCmd(claudeExec, options);

  const term = pty.spawn('/bin/bash', ['-c', shellCmd], {
    name: 'xterm-color',
    cols: 220,
    rows: 50,
    cwd:  options.cwd ?? process.cwd(),
    env:  { ...options.env ?? process.env },
  });

  const queue       = makeQueue();
  const pendingCtrl = new Map();   // request_id → { resolve, reject }
  let closed        = false;
  let promptSent    = false;
  let initRequestId = null;   // request_id of the pending initialize handshake
  let lineBuf       = '';

  // ── stdin helpers ──────────────────────────────────────────────────────────

  function writeJson(obj) {
    if (!closed) term.write(JSON.stringify(obj) + '\n');
  }

  function sendUserMessage() {
    writeJson({
      type:              'user',
      message:           { role: 'user', content: [{ type: 'text', text: prompt }] },
      session_id:        options.sessionId ?? '',
      parent_tool_use_id: null,
    });
  }

  function sendControlResp(request_id, response = {}) {
    writeJson({ type: T_CTRL_RESP, response: { subtype: S_SUCCESS, request_id, response } });
  }

  function sendControlReq(subtype, params = {}) {
    return new Promise((resolve, reject) => {
      const request_id = genId();
      pendingCtrl.set(request_id, { resolve, reject });
      writeJson({ type: T_CTRL_REQ, request_id, request: { subtype, ...params } });
    });
  }

  // ── stdout router ──────────────────────────────────────────────────────────

  function sendProtocolInit() {
    // Required SDK handshake: CLI waits for this before accepting user messages.
    // Mirrors open-claude-agent-sdk/src/api/protocolInit.ts — minimal variant.
    initRequestId = `init_${Date.now()}`;
    writeJson({
      type:       T_CTRL_REQ,
      request_id: initRequestId,
      request: {
        subtype:      'initialize',
        systemPrompt: [''],
      },
    });
  }

  function route(msg) {
    // Outbound control response (CLI → SDK ack)
    if (msg.type === T_CTRL_RESP) {
      const r = msg.response;
      if (!r) return;

      // initialize handshake ack → send the user prompt
      if (r.request_id === initRequestId && !promptSent) {
        promptSent = true;
        initRequestId = null;
        sendUserMessage();
        return;
      }

      const p = pendingCtrl.get(r.request_id);
      if (p) {
        pendingCtrl.delete(r.request_id);
        r.subtype === S_SUCCESS ? p.resolve(r.response ?? {}) : p.reject(new Error(r.error ?? 'control error'));
      }
      return;
    }

    // Inbound control request (CLI asking SDK for permission/callback)
    if (msg.type === T_CTRL_REQ) {
      const sub = msg.request?.subtype;
      // bypassPermissions: always allow tool use; auto-respond to everything else
      if (sub === 'can_use_tool') {
        sendControlResp(msg.request_id, { behavior: 'allow' });
      } else {
        sendControlResp(msg.request_id, {});
      }
      return;
    }

    // system/init: claude is ready — send protocol handshake (user msg follows after ack)
    if (msg.type === 'system' && msg.subtype === 'init' && !initRequestId && !promptSent) {
      sendProtocolInit();
    }

    // All regular messages go into the consumer queue
    queue.push(msg);
  }

  // ── PTY data handler ───────────────────────────────────────────────────────

  term.onData((chunk) => {
    lineBuf += chunk;
    const lines = lineBuf.split('\n');
    lineBuf = lines.pop() ?? '';
    for (const raw of lines) {
      const line = stripAnsi(raw);
      if (!line.startsWith('{')) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      route(msg);
    }
  });

  term.onExit(() => {
    closed = true;
    queue.drainWaiters(null);
    for (const [, p] of pendingCtrl) p.reject(new Error('claude process exited'));
    pendingCtrl.clear();
  });

  // ── Public interface ───────────────────────────────────────────────────────

  return {
    /** AsyncIterable — yields SDK-format messages until type=result or process exit */
    async *[Symbol.asyncIterator]() {
      while (true) {
        const msg = await queue.shift();
        if (msg === null) break;
        yield msg;
        if (msg.type === 'result') break;
      }
    },

    // Control methods matching the SDK Query interface used in claude-sdk.js
    interrupt()        { return sendControlReq('interrupt'); },
    setModel(model)    { return sendControlReq('set_model', { model }); },
    getContextUsage()  { return sendControlReq('get_context_usage'); },
    mcpServerStatus()  { return sendControlReq('mcp_status'); },

    // Not available in simple PTY mode — resolve null gracefully (optional chaining in callers)
    supportedCommands: () => Promise.resolve(null),
    supportedAgents:   () => Promise.resolve(null),

    /** Kill the underlying PTY process */
    destroy() {
      closed = true;
      queue.drainWaiters(null);
      try { term.kill(); } catch {}
    },
  };
}
