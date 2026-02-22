'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let WebSocketServerCtor = null;
let pty = null;
try {
  ({ WebSocketServer: WebSocketServerCtor } = require('ws'));
} catch {
  WebSocketServerCtor = null;
}
try {
  pty = require('node-pty');
} catch {
  pty = null;
}

function slugify(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'persona';
}

function createChunkRing(maxChars) {
  const chunks = [];
  let total = 0;

  return {
    push(text) {
      const value = String(text || '');
      if (!value) return;
      chunks.push(value);
      total += value.length;
      while (total > maxChars && chunks.length) {
        const first = chunks[0] || '';
        const overflow = total - maxChars;
        if (first.length <= overflow) {
          chunks.shift();
          total -= first.length;
          continue;
        }
        chunks[0] = first.slice(overflow);
        total -= overflow;
      }
    },
    dump() {
      return chunks.join('');
    },
    clear() {
      chunks.length = 0;
      total = 0;
    },
    size() {
      return total;
    }
  };
}

function stripAnsi(raw) {
  let t = String(raw || '');
  if (!t) return '';
  t = t.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '');
  t = t.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  t = t.replace(/\u001b[@-Z\\-_]/g, '');
  t = t.replace(/\u0008/g, '');
  t = t.replace(/\r(?!\n)/g, '\n');
  return t;
}

function safeJsonParse(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function maybeJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const parsed = safeJsonParse(text);
  return parsed.ok ? parsed.value : null;
}

function nowDateStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function randId(prefix) {
  const a = Math.random().toString(36).slice(2, 8);
  const b = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${a}${b}`;
}

function spawnSyncText(cmd, args) {
  try {
    const r = spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: 12_000,
      maxBuffer: 512 * 1024
    });
    return {
      ok: r.status === 0,
      status: r.status,
      stdout: String(r.stdout || ''),
      stderr: String(r.stderr || ''),
      error: r.error ? (r.error.message || String(r.error)) : ''
    };
  } catch (e) {
    return { ok: false, status: null, stdout: '', stderr: '', error: e instanceof Error ? e.message : String(e) };
  }
}

function detectVersion(binary) {
  for (const args of [['--version'], ['-v']]) {
    const r = spawnSyncText(binary, args);
    const text = `${r.stdout}${r.stderr}`.trim();
    if (text) return text.split(/\r?\n/)[0] || text;
  }
  return '';
}

function sendSocket(ws, msg) {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  } catch {
    // ignore broken sockets; close handler cleans up.
  }
}

function sendUpgradeHttpError(socket, code, text) {
  try {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    // ignore
  }
  try {
    socket.destroy();
  } catch {
    // ignore
  }
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function chooseRandom(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx] || list[0] || null;
}

function parseAuthHint(raw) {
  const text = String(raw || '');
  const urls = Array.from(text.matchAll(/https?:\/\/[^\s<>()"']+/g)).map((m) => m[0]);
  const deviceCodeMatch = text.match(/\b[A-Z0-9]{4}(?:-[A-Z0-9]{4}){1,4}\b/);
  if (!urls.length && !deviceCodeMatch) return null;
  return {
    type: 'auth_hint',
    url: urls[0] || undefined,
    code: deviceCodeMatch ? deviceCodeMatch[0] : undefined,
    text: text.trim().slice(0, 500)
  };
}

function summarizeFallback(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return '';

  const out = [];
  for (const line of lines) {
    if (out.length >= 8) break;
    if (/^(\$|>|#|%|\[|\]|\(|\)|\{|\})$/.test(line)) continue;
    if (line.length < 2) continue;
    out.push(`- ${line.slice(0, 220)}`);
  }

  if (!out.length) {
    return `- ${text.replace(/\s+/g, ' ').slice(0, 600)}`;
  }

  return out.join('\n');
}

function createAiCliFeature(options) {
  const {
    DATA_DIR,
    AUDIO_DIR,
    DEFAULT_PERSONAS,
    ensureDir,
    nowIso,
    sendJson,
    jsonError,
    readBody,
    readEnvMap,
    callGemini,
    generateInworldAudio
  } = options;

  const HOME_DIR = os.homedir();
  const SHARED_REPOS_DIR = path.join(HOME_DIR, 'shared-repos');
  const AI_CLI_DATA_DIR = path.join(DATA_DIR, 'ai-cli');
  const AI_CLI_TRANSCRIPTS_DIR = path.join(AI_CLI_DATA_DIR, 'transcripts');
  const AI_CLI_META_DIR = path.join(AI_CLI_DATA_DIR, 'metadata');
  const MAX_RECONNECT_CHARS = 220_000;
  const MAX_OUTPUT_SEGMENTS = 800;
  const MAX_OUTPUT_SEGMENT_CHARS = 220_000;
  const MAX_AUTH_LOG_CHARS = 60_000;
  const KEEP_CLI_AUDIO_FILES = 60;

  const personas = Array.isArray(DEFAULT_PERSONAS)
    ? DEFAULT_PERSONAS.map((p, index) => ({
        id: slugify(p && p.name ? p.name : `persona-${index + 1}`),
        name: p && p.name ? String(p.name) : `Persona ${index + 1}`,
        voiceId: p && p.voiceId ? String(p.voiceId) : '',
        personality: p && p.personality ? String(p.personality) : ''
      }))
    : [];

  const providerDefs = {
    codex: {
      id: 'codex',
      title: 'ChatGPT Codex CLI',
      binary: 'codex',
      workspace: path.join(HOME_DIR, 'codex-workspace'),
      makeMainArgs() {
        return [
          '--dangerously-bypass-approvals-and-sandbox',
          '-C',
          this.workspace,
          '--add-dir',
          HOME_DIR,
          '--no-alt-screen'
        ];
      },
      auth: {
        login: ['login', '--device-auth'],
        status: ['login', 'status'],
        logout: ['logout'],
        canStatus: true,
        canLogout: true
      }
    },
    claude: {
      id: 'claude',
      title: 'Claude Code CLI',
      binary: 'claude',
      workspace: path.join(HOME_DIR, 'claude-workspace'),
      makeMainArgs() {
        return [
          '--allow-dangerously-skip-permissions',
          '--dangerously-skip-permissions',
          '--permission-mode',
          'bypassPermissions',
          '--add-dir',
          HOME_DIR
        ];
      },
      auth: {
        login: ['auth', 'login'],
        status: ['auth', 'status'],
        logout: ['auth', 'logout'],
        canStatus: true,
        canLogout: true
      }
    },
    gemini: {
      id: 'gemini',
      title: 'Gemini Code CLI',
      binary: 'gemini',
      workspace: path.join(HOME_DIR, 'gemini-workspace'),
      makeMainArgs() {
        return [
          '--approval-mode=yolo',
          '--sandbox=false',
          '--include-directories',
          HOME_DIR
        ];
      },
      auth: {
        login: [],
        status: null,
        logout: null,
        canStatus: false,
        canLogout: false
      }
    }
  };

  function createChannelState(providerId, channel) {
    return {
      providerId,
      channel,
      proc: null,
      pid: null,
      running: false,
      stopping: false,
      startedAt: '',
      exitedAt: '',
      exitCode: null,
      exitSignal: null,
      lastError: '',
      cols: 120,
      rows: 34,
      reconnect: createChunkRing(channel === 'main' ? MAX_RECONNECT_CHARS : MAX_AUTH_LOG_CHARS),
      sockets: new Set(),
      outputSeq: 0,
      outputSegments: [],
      outputChars: 0,
      stopWaiters: []
    };
  }

  const providerState = {};
  for (const providerId of Object.keys(providerDefs)) {
    const def = providerDefs[providerId];
    providerState[providerId] = {
      id: providerId,
      def,
      main: createChannelState(providerId, 'main'),
      auth: createChannelState(providerId, 'auth'),
      authStatus: {
        status: 'unknown',
        detail: '',
        checkedAt: '',
        method: providerId === 'gemini' ? 'best-effort' : 'cli-status'
      },
      version: '',
      versionCheckedAt: '',
      personaPreference: {
        mode: 'selected',
        personaId: personas[0]?.id || ''
      },
      lastComposerInteraction: null
    };
  }

  function ensureRuntimeDirs() {
    ensureDir(AI_CLI_DATA_DIR, 0o700);
    ensureDir(AI_CLI_TRANSCRIPTS_DIR, 0o700);
    ensureDir(AI_CLI_META_DIR, 0o700);
    ensureDir(SHARED_REPOS_DIR, 0o700);
    for (const p of Object.values(providerDefs)) {
      ensureDir(p.workspace, 0o700);
    }
  }

  function transcriptFile(providerId, channel) {
    ensureRuntimeDirs();
    return path.join(AI_CLI_TRANSCRIPTS_DIR, `${providerId}-${channel}-${nowDateStamp()}.jsonl`);
  }

  function appendTranscript(providerId, channel, source, text) {
    const value = String(text || '');
    if (!value) return;
    try {
      const file = transcriptFile(providerId, channel);
      const line = JSON.stringify({ ts: nowIso(), provider: providerId, channel, source, text: value }) + '\n';
      fs.appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 });
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        // ignore chmod issues
      }
    } catch {
      // transcript persistence should not break terminal flow.
    }
  }

  function appendOutputSegment(ch, rawChunk) {
    const plain = stripAnsi(rawChunk);
    const text = String(plain || '');
    if (!text.trim()) return;

    ch.outputSeq += 1;
    ch.outputSegments.push({ seq: ch.outputSeq, ts: nowIso(), text });
    ch.outputChars += text.length;

    while (
      ch.outputSegments.length > MAX_OUTPUT_SEGMENTS ||
      (ch.outputChars > MAX_OUTPUT_SEGMENT_CHARS && ch.outputSegments.length > 1)
    ) {
      const removed = ch.outputSegments.shift();
      if (!removed) break;
      ch.outputChars -= String(removed.text || '').length;
      if (ch.outputChars < 0) ch.outputChars = 0;
    }
  }

  function channelSummary(ch) {
    return {
      channel: ch.channel,
      running: ch.running,
      stopping: ch.stopping,
      pid: ch.pid,
      startedAt: ch.startedAt || null,
      exitedAt: ch.exitedAt || null,
      exitCode: ch.exitCode,
      exitSignal: ch.exitSignal,
      cols: ch.cols,
      rows: ch.rows,
      clients: ch.sockets.size,
      reconnectChars: ch.reconnect.size(),
      lastError: ch.lastError || null
    };
  }

  function serializeProvider(p) {
    const state = providerState[p.id];
    const auth = state.authStatus || {};
    return {
      id: p.id,
      title: p.title,
      binary: p.binary,
      workspace: p.workspace,
      sharedReposDir: SHARED_REPOS_DIR,
      sharedReposExists: fs.existsSync(SHARED_REPOS_DIR),
      version: state.version || null,
      versionCheckedAt: state.versionCheckedAt || null,
      session: channelSummary(state.main),
      authJob: channelSummary(state.auth),
      authStatus: {
        status: auth.status || 'unknown',
        detail: auth.detail || '',
        checkedAt: auth.checkedAt || null,
        method: auth.method || 'unknown'
      },
      personaPreference: {
        mode: state.personaPreference.mode,
        personaId: state.personaPreference.personaId
      },
      capabilities: {
        browserAuth: true,
        personaComposer: true,
        narration: true,
        rawTerminal: true,
        authStatus: Boolean(p.auth && p.auth.canStatus),
        authLogout: Boolean(p.auth && p.auth.canLogout)
      },
      access: {
        fullHomeAccess: true,
        homeDir: HOME_DIR,
        sharedReposDir: SHARED_REPOS_DIR,
        approvalModeLocked: true
      },
      lastComposerInteraction: state.lastComposerInteraction
        ? {
            at: state.lastComposerInteraction.at,
            persona: state.lastComposerInteraction.persona,
            promptPreview: state.lastComposerInteraction.promptPreview
          }
        : null
    };
  }

  function serializeAllProviders() {
    return Object.values(providerDefs).map((p) => serializeProvider(p));
  }

  function primeVersions() {
    for (const p of Object.values(providerDefs)) {
      const state = providerState[p.id];
      if (state.version) continue;
      state.version = detectVersion(p.binary);
      state.versionCheckedAt = nowIso();
    }
  }

  function parseCodexAuthStatus(text) {
    const raw = String(text || '').trim();
    if (!raw) return { status: 'unknown', detail: '' };
    if (/logged in/i.test(raw)) return { status: 'logged_in', detail: raw.split(/\r?\n/)[0] || raw };
    if (/not logged in/i.test(raw)) return { status: 'logged_out', detail: raw.split(/\r?\n/)[0] || raw };
    return { status: 'unknown', detail: raw.split(/\r?\n/)[0] || raw };
  }

  function parseClaudeAuthStatus(text) {
    const raw = String(text || '').trim();
    const parsed = maybeJson(raw);
    if (parsed && typeof parsed === 'object') {
      const loggedIn = parsed.loggedIn;
      if (loggedIn === true) {
        return {
          status: 'logged_in',
          detail: parsed.email ? `Logged in as ${parsed.email}` : 'Logged in'
        };
      }
      if (loggedIn === false) return { status: 'logged_out', detail: 'Logged out' };
    }
    if (/logged in/i.test(raw)) return { status: 'logged_in', detail: raw.split(/\r?\n/)[0] || raw };
    if (/logged out|not logged/i.test(raw)) return { status: 'logged_out', detail: raw.split(/\r?\n/)[0] || raw };
    return { status: 'unknown', detail: raw.split(/\r?\n/)[0] || raw };
  }

  function refreshAuthStatus(providerId) {
    const state = providerState[providerId];
    if (!state) throw new Error('unknown provider');
    const def = state.def;

    if (providerId === 'gemini' || !def.auth || !def.auth.canStatus || !Array.isArray(def.auth.status)) {
      state.authStatus = {
        status: 'unknown',
        detail: 'Gemini CLI auth status is not exposed by this version; use Login to validate interactively.',
        checkedAt: nowIso(),
        method: 'best-effort'
      };
      return state.authStatus;
    }

    const r = spawnSyncText(def.binary, def.auth.status);
    const merged = `${r.stdout}${r.stderr}`.trim();
    let parsed;

    if (providerId === 'codex') parsed = parseCodexAuthStatus(merged);
    else if (providerId === 'claude') parsed = parseClaudeAuthStatus(merged);
    else parsed = { status: 'unknown', detail: merged || r.error || '' };

    if (!r.ok && parsed.status === 'unknown') {
      parsed.detail = parsed.detail || r.error || `exit ${r.status}`;
    }

    state.authStatus = {
      status: parsed.status,
      detail: parsed.detail || '',
      checkedAt: nowIso(),
      method: 'cli-status'
    };
    return state.authStatus;
  }

  function wsChannelBroadcast(ch, msg) {
    for (const ws of ch.sockets) {
      sendSocket(ws, msg);
    }
  }

  function broadcastProviderState(providerId) {
    const state = providerState[providerId];
    if (!state) return;
    const payload = {
      type: 'state',
      provider: providerId,
      session: channelSummary(state.main),
      authJob: channelSummary(state.auth),
      authStatus: state.authStatus,
      lastComposerInteraction: state.lastComposerInteraction
        ? {
            at: state.lastComposerInteraction.at,
            persona: state.lastComposerInteraction.persona,
            promptPreview: state.lastComposerInteraction.promptPreview
          }
        : null
    };
    wsChannelBroadcast(state.main, payload);
    wsChannelBroadcast(state.auth, payload);
  }

  function resetChannelForStart(ch) {
    ch.reconnect.clear();
    ch.outputSeq = 0;
    ch.outputSegments = [];
    ch.outputChars = 0;
    ch.exitCode = null;
    ch.exitSignal = null;
    ch.exitedAt = '';
    ch.lastError = '';
    ch.stopping = false;
  }

  function spawnChannel(providerId, channelName, cmd, args, cwd) {
    const state = providerState[providerId];
    if (!state) throw new Error('unknown provider');
    const ch = state[channelName];
    if (!ch) throw new Error('unknown channel');
    if (!pty) throw new Error('node-pty is not installed on the dashboard API host');

    ensureRuntimeDirs();
    if (ch.running && ch.proc) return ch;

    resetChannelForStart(ch);
    ch.startedAt = nowIso();
    ch.running = true;

    const proc = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cwd,
      cols: ch.cols,
      rows: ch.rows,
      env: {
        ...process.env,
        HOME: HOME_DIR,
        TERM: 'xterm-256color'
      }
    });

    ch.proc = proc;
    ch.pid = proc.pid;
    appendTranscript(providerId, channelName, 'sys', `spawn ${cmd} ${args.join(' ')}`);

    proc.onData((data) => {
      const value = String(data || '');
      if (!value) return;
      ch.reconnect.push(value);
      appendTranscript(providerId, channelName, 'out', value);
      if (channelName === 'main') appendOutputSegment(ch, value);
      wsChannelBroadcast(ch, { type: 'output', provider: providerId, channel: channelName, data: value });

      if (channelName === 'auth') {
        const hint = parseAuthHint(value);
        if (hint) wsChannelBroadcast(ch, { ...hint, provider: providerId, channel: channelName });
      }
    });

    proc.onExit((evt) => {
      ch.running = false;
      ch.stopping = false;
      ch.exitedAt = nowIso();
      ch.exitCode = evt && Number.isFinite(evt.exitCode) ? evt.exitCode : null;
      ch.exitSignal = evt && evt.signal != null ? String(evt.signal) : null;
      ch.proc = null;
      ch.pid = null;
      appendTranscript(providerId, channelName, 'sys', `exit code=${ch.exitCode} signal=${ch.exitSignal || ''}`);
      wsChannelBroadcast(ch, {
        type: 'exit',
        provider: providerId,
        channel: channelName,
        code: ch.exitCode,
        signal: ch.exitSignal
      });
      const waiters = ch.stopWaiters.splice(0);
      for (const resolve of waiters) {
        try {
          resolve();
        } catch {
          // ignore waiter errors
        }
      }
      if (channelName === 'auth') {
        try {
          refreshAuthStatus(providerId);
        } catch {
          // best effort
        }
      }
      broadcastProviderState(providerId);
    });

    broadcastProviderState(providerId);
    return ch;
  }

  function ensureMainSession(providerId) {
    const state = providerState[providerId];
    if (!state) throw new Error('unknown provider');
    const def = state.def;
    ensureRuntimeDirs();
    if (state.main.running) return state.main;
    const args = def.makeMainArgs();
    return spawnChannel(providerId, 'main', def.binary, args, def.workspace);
  }

  function startAuthJob(providerId, mode) {
    const state = providerState[providerId];
    if (!state) throw new Error('unknown provider');
    const def = state.def;
    ensureRuntimeDirs();

    if (state.auth.running) return state.auth;

    let cmd = def.binary;
    let args = [];
    if (providerId === 'gemini') {
      if (mode === 'login') {
        args = [];
      } else {
        throw new Error('unsupported Gemini auth action');
      }
    } else if (mode === 'login') {
      args = Array.isArray(def.auth.login) ? def.auth.login.slice() : [];
    } else {
      throw new Error(`unsupported auth mode: ${mode}`);
    }

    const ch = spawnChannel(providerId, 'auth', cmd, args, def.workspace);
    appendTranscript(providerId, 'auth', 'sys', `auth-mode ${mode}`);
    return ch;
  }

  function stopChannel(providerId, channelName) {
    const state = providerState[providerId];
    if (!state) throw new Error('unknown provider');
    const ch = state[channelName];
    if (!ch) throw new Error('unknown channel');

    if (!ch.running || !ch.proc) {
      ch.stopping = false;
      return Promise.resolve();
    }

    ch.stopping = true;
    broadcastProviderState(providerId);

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      ch.stopWaiters.push(finish);

      try {
        ch.proc.kill('SIGTERM');
      } catch {
        // ignore
      }

      setTimeout(() => {
        if (!ch.running || !ch.proc) {
          finish();
          return;
        }
        try {
          ch.proc.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 1500);

      setTimeout(finish, 4000);
    });
  }

  function getProviderOrThrow(providerId) {
    const state = providerState[String(providerId || '').trim()];
    if (!state) throw new Error('unknown provider');
    return state;
  }

  function choosePersona(mode, personaId) {
    const safeMode = String(mode || '').trim() === 'random' ? 'random' : 'selected';
    let persona = null;

    if (safeMode === 'random') {
      persona = chooseRandom(personas);
    } else {
      const desired = String(personaId || '').trim();
      persona = personas.find((p) => p.id === desired) || personas[0] || null;
    }

    return {
      mode: safeMode,
      persona: persona || null
    };
  }

  function writeToChannel(providerId, channelName, data) {
    const state = getProviderOrThrow(providerId);
    const ch = state[channelName];
    if (!ch || !ch.running || !ch.proc) throw new Error(`${channelName} session is not running`);
    const value = String(data || '');
    if (!value) return;
    appendTranscript(providerId, channelName, 'in', value);
    ch.proc.write(value);
  }

  function buildPersonaPrompt(providerId, persona, userText) {
    const personaName = persona?.name ? String(persona.name) : 'Persona';
    const personality = persona?.personality ? String(persona.personality).trim() : '';
    const request = String(userText || '').trim();

    const lines = [
      `Dashboard persona mode (${personaName}) for ${providerId}:`,
      'Answer the following request in this persona voice while preserving technical accuracy and actionable detail.',
      'If writing code or commands, prefer concrete steps and explain assumptions briefly.'
    ];

    if (personality) {
      lines.push('', `Persona profile: ${personality}`);
    }

    lines.push('', 'User request:', request, '');
    return lines.join('\n');
  }

  function extractTextSinceMarker(providerId) {
    const state = getProviderOrThrow(providerId);
    const marker = state.lastComposerInteraction;
    if (!marker) return { text: '', marker: null };

    const segs = state.main.outputSegments.filter((seg) => seg.seq > Number(marker.seqBefore || 0));
    const joined = segs.map((seg) => seg.text).join('');
    let text = String(joined || '');
    text = text.replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > 14000) text = text.slice(-14000);
    return { text, marker };
  }

  async function summarizeForNarration(providerId, persona, outputText) {
    const env = readEnvMap();
    const geminiApiKey = String(env.GEMINI_API_KEY || '').trim();
    const basePrompt = [
      `You are ${persona?.name || 'a technical assistant'} summarizing a terminal/code-assistant session output for a dashboard user.`,
      persona?.personality ? `Persona style guide: ${persona.personality}` : '',
      'Summarize the output in concise bullet points (4-8 bullets).',
      'Focus on concrete results, errors, changed files, and next actions.',
      'Do not invent details. If the output is partial/unclear, say so.',
      '',
      'Terminal output:',
      outputText
    ]
      .filter(Boolean)
      .join('\n');

    if (geminiApiKey && typeof callGemini === 'function') {
      try {
        const text = String(await callGemini(geminiApiKey, basePrompt)).trim();
        if (text) return text;
      } catch {
        // fall back locally
      }
    }

    return summarizeFallback(outputText);
  }

  function pruneCliAudio() {
    try {
      if (!fs.existsSync(AUDIO_DIR)) return;
      const entries = fs
        .readdirSync(AUDIO_DIR)
        .filter((name) => /^cli-(codex|claude|gemini)-/i.test(name))
        .map((name) => {
          const file = path.join(AUDIO_DIR, name);
          let mtimeMs = 0;
          try {
            mtimeMs = fs.statSync(file).mtimeMs || 0;
          } catch {
            mtimeMs = 0;
          }
          return { name, file, mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      for (const entry of entries.slice(KEEP_CLI_AUDIO_FILES)) {
        try {
          fs.unlinkSync(entry.file);
        } catch {
          // ignore delete failures
        }
      }
    } catch {
      // ignore pruning failures
    }
  }

  async function narrateLast(providerId, body) {
    const state = getProviderOrThrow(providerId);
    const chosen = choosePersona(body?.mode, body?.personaId);
    const explicitPersona = chosen.persona;
    const { text, marker } = extractTextSinceMarker(providerId);
    if (!marker) throw new Error('No persona-composer interaction found yet');
    if (!text) throw new Error('No terminal output captured after the last persona-composer prompt');

    const markerPersona = marker.persona && typeof marker.persona === 'object' ? marker.persona : null;
    const persona = explicitPersona || markerPersona || personas[0] || { name: 'Narrator', voiceId: '', personality: '' };

    const summaryText = await summarizeForNarration(providerId, persona, text);
    const env = readEnvMap();
    const inworldApiKey = String(env.INWORLD_API_KEY || '').trim();
    const inworldSecret = String(env.INWORLD_SECRET || '').trim();

    const audioPlaylist = [];
    if (
      inworldApiKey &&
      inworldSecret &&
      persona.voiceId &&
      summaryText &&
      summaryText.length >= 20 &&
      typeof generateInworldAudio === 'function'
    ) {
      try {
        const audio = await generateInworldAudio(
          inworldApiKey,
          inworldSecret,
          persona.voiceId,
          summaryText,
          `cli-${providerId}-${Date.now()}`
        );
        if (audio && audio.url) {
          audioPlaylist.push({
            title: `${persona.name} CLI Summary`,
            url: String(audio.url),
            type: 'audio/mpeg',
            voice: persona.voiceId
          });
          pruneCliAudio();
        }
      } catch {
        // return summary even if audio generation fails
      }
    }

    return {
      ok: true,
      provider: providerId,
      generatedAt: nowIso(),
      summaryText,
      persona: {
        id: persona.id || slugify(persona.name || 'persona'),
        name: persona.name || 'Persona',
        voiceId: persona.voiceId || ''
      },
      audioPlaylist,
      source: {
        chars: text.length,
        promptAt: marker.at,
        promptPreview: marker.promptPreview || ''
      }
    };
  }

  async function readJsonBody(req) {
    const raw = await readBody(req, 512 * 1024);
    if (!raw) return {};
    const parsed = safeJsonParse(raw);
    if (!parsed.ok) throw new Error('invalid json');
    return parsed.value && typeof parsed.value === 'object' ? parsed.value : {};
  }

  async function handlePersonaSend(providerId, req, res) {
    const state = getProviderOrThrow(providerId);
    const body = await readJsonBody(req);
    const text = String(body?.text || '').trim();
    if (!text) {
      jsonError(res, 400, 'missing text');
      return;
    }
    if (!state.main.running) {
      jsonError(res, 409, 'main session is not running');
      return;
    }

    const chosen = choosePersona(body?.mode, body?.personaId);
    const persona = chosen.persona;
    if (!persona) {
      jsonError(res, 500, 'no personas configured');
      return;
    }

    state.personaPreference = { mode: chosen.mode, personaId: persona.id };

    const wrapped = buildPersonaPrompt(providerId, persona, text);
    state.lastComposerInteraction = {
      id: randId('composer'),
      at: nowIso(),
      seqBefore: state.main.outputSeq,
      persona: {
        id: persona.id,
        name: persona.name,
        voiceId: persona.voiceId || ''
      },
      mode: chosen.mode,
      promptPreview: text.slice(0, 200)
    };

    try {
      writeToChannel(providerId, 'main', wrapped + '\r');
    } catch (e) {
      jsonError(res, 500, e instanceof Error ? e.message : String(e));
      return;
    }

    broadcastProviderState(providerId);
    sendJson(res, 200, {
      ok: true,
      provider: providerId,
      sentAt: nowIso(),
      mode: chosen.mode,
      persona: {
        id: persona.id,
        name: persona.name,
        voiceId: persona.voiceId || ''
      },
      promptPreview: text.slice(0, 200)
    });
  }

  async function handleNarrateLast(providerId, req, res) {
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch (e) {
      jsonError(res, 400, e instanceof Error ? e.message : String(e));
      return;
    }

    try {
      const payload = await narrateLast(providerId, body);
      sendJson(res, 200, payload);
    } catch (e) {
      jsonError(res, 400, e instanceof Error ? e.message : String(e));
    }
  }

  async function handleAuthLogout(providerId, res) {
    const state = getProviderOrThrow(providerId);
    const def = state.def;
    if (!def.auth || !def.auth.canLogout || !Array.isArray(def.auth.logout)) {
      jsonError(res, 400, 'logout is not supported for this provider in MVP');
      return;
    }

    const r = spawnSyncText(def.binary, def.auth.logout);
    const text = `${r.stdout}${r.stderr}`.trim();
    try {
      refreshAuthStatus(providerId);
    } catch {
      // best effort
    }
    sendJson(res, 200, {
      ok: r.ok,
      provider: providerId,
      status: r.status,
      output: text.slice(0, 4000),
      authStatus: providerState[providerId].authStatus
    });
  }

  async function handleHttp(req, res, url) {
    const pathname = String(url?.pathname || '');
    if (!pathname.startsWith('/api/ai-cli')) return false;

    try {
      if (pathname === '/api/ai-cli/providers' && req.method === 'GET') {
        primeVersions();
        try {
          for (const id of Object.keys(providerDefs)) refreshAuthStatus(id);
        } catch {
          // best effort per provider; individual endpoints can refresh later.
        }
        sendJson(res, 200, {
          ok: true,
          now: nowIso(),
          dependencies: {
            ws: Boolean(WebSocketServerCtor),
            nodePty: Boolean(pty)
          },
          personasAvailable: personas.length,
          providers: serializeAllProviders()
        });
        return true;
      }

      if (pathname === '/api/ai-cli/personas' && req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          personas: personas.map((p) => ({ id: p.id, name: p.name, voiceId: p.voiceId || '' }))
        });
        return true;
      }

      const sessionMatch = pathname.match(/^\/api\/ai-cli\/session\/([^/]+)(?:\/(.*))?$/);
      if (!sessionMatch) {
        jsonError(res, 404, 'not found');
        return true;
      }

      const providerId = decodeURIComponent(sessionMatch[1] || '').trim();
      const state = providerState[providerId];
      if (!state) {
        jsonError(res, 404, 'unknown provider');
        return true;
      }
      const tail = String(sessionMatch[2] || '').replace(/\/+$/, '');

      if (!tail && req.method === 'GET') {
        primeVersions();
        sendJson(res, 200, { ok: true, provider: serializeProvider(state.def) });
        return true;
      }

      if (tail === 'start' && req.method === 'POST') {
        if (!pty) {
          jsonError(res, 503, 'node-pty dependency is not installed');
          return true;
        }
        ensureMainSession(providerId);
        primeVersions();
        sendJson(res, 200, { ok: true, provider: serializeProvider(state.def) });
        return true;
      }

      if (tail === 'stop' && req.method === 'POST') {
        await stopChannel(providerId, 'main');
        sendJson(res, 200, { ok: true, provider: serializeProvider(state.def) });
        return true;
      }

      if (tail === 'restart' && req.method === 'POST') {
        if (!pty) {
          jsonError(res, 503, 'node-pty dependency is not installed');
          return true;
        }
        await stopChannel(providerId, 'main');
        ensureMainSession(providerId);
        sendJson(res, 200, { ok: true, provider: serializeProvider(state.def) });
        return true;
      }

      if (tail === 'persona/send' && req.method === 'POST') {
        await handlePersonaSend(providerId, req, res);
        return true;
      }

      if (tail === 'narrate-last' && req.method === 'POST') {
        await handleNarrateLast(providerId, req, res);
        return true;
      }

      if (tail === 'auth/login' && req.method === 'POST') {
        if (!pty) {
          jsonError(res, 503, 'node-pty dependency is not installed');
          return true;
        }
        startAuthJob(providerId, 'login');
        sendJson(res, 200, { ok: true, provider: serializeProvider(state.def) });
        return true;
      }

      if (tail === 'auth/status' && req.method === 'POST') {
        const authStatus = refreshAuthStatus(providerId);
        sendJson(res, 200, { ok: true, provider: providerId, authStatus, providerState: serializeProvider(state.def) });
        return true;
      }

      if (tail === 'auth/logout' && req.method === 'POST') {
        await handleAuthLogout(providerId, res);
        return true;
      }

      if (tail === 'auth/stop' && req.method === 'POST') {
        await stopChannel(providerId, 'auth');
        sendJson(res, 200, { ok: true, provider: serializeProvider(state.def) });
        return true;
      }

      jsonError(res, 404, 'not found');
      return true;
    } catch (e) {
      jsonError(res, 500, e instanceof Error ? e.message : String(e));
      return true;
    }
  }

  const wss = WebSocketServerCtor ? new WebSocketServerCtor({ noServer: true }) : null;

  function attachSocket(ws, providerId, channelName) {
    const state = providerState[providerId];
    if (!state) {
      sendSocket(ws, { type: 'error', message: 'unknown provider' });
      try {
        ws.close();
      } catch {
        // ignore
      }
      return;
    }
    const ch = state[channelName];
    if (!ch) {
      sendSocket(ws, { type: 'error', message: 'unknown channel' });
      try {
        ws.close();
      } catch {
        // ignore
      }
      return;
    }

    ch.sockets.add(ws);

    sendSocket(ws, {
      type: 'hello',
      provider: providerId,
      channel: channelName,
      state: {
        session: channelSummary(state.main),
        authJob: channelSummary(state.auth),
        authStatus: state.authStatus
      }
    });

    const snapshot = ch.reconnect.dump();
    if (snapshot) {
      sendSocket(ws, { type: 'snapshot', provider: providerId, channel: channelName, data: snapshot });
    }

    ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(String(buf || ''));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      const type = String(msg.type || '').trim();

      if (type === 'ping') {
        sendSocket(ws, { type: 'pong', ts: Number(msg.ts || Date.now()) });
        return;
      }

      if (type === 'input') {
        try {
          writeToChannel(providerId, channelName, String(msg.data || ''));
        } catch (e) {
          sendSocket(ws, { type: 'error', message: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      if (type === 'resize') {
        const cols = clampInt(msg.cols, 20, 400, ch.cols);
        const rows = clampInt(msg.rows, 5, 200, ch.rows);
        ch.cols = cols;
        ch.rows = rows;
        if (ch.running && ch.proc) {
          try {
            ch.proc.resize(cols, rows);
          } catch {
            // ignore resize failures
          }
        }
        return;
      }
    });

    ws.on('close', () => {
      ch.sockets.delete(ws);
      broadcastProviderState(providerId);
    });

    ws.on('error', () => {
      ch.sockets.delete(ws);
    });

    broadcastProviderState(providerId);
  }

  function handleUpgrade(req, socket, head) {
    if (!wss) {
      sendUpgradeHttpError(socket, 503, 'Service Unavailable');
      return true;
    }

    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      sendUpgradeHttpError(socket, 400, 'Bad Request');
      return true;
    }

    if (url.pathname !== '/api/ai-cli/ws') return false;

    const providerId = String(url.searchParams.get('provider') || '').trim();
    const channelName = String(url.searchParams.get('channel') || 'main').trim() === 'auth' ? 'auth' : 'main';
    if (!providerState[providerId]) {
      sendUpgradeHttpError(socket, 404, 'Not Found');
      return true;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      attachSocket(ws, providerId, channelName);
    });

    return true;
  }

  return {
    handleHttp,
    handleUpgrade,
    getState() {
      return serializeAllProviders();
    }
  };
}

module.exports = {
  createAiCliFeature
};
