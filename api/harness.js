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

const { detectPlaywright, normalizeScenarios, runBrowserValidation } = require('./harness-playwright');

function slugify(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'task';
}

function randomId(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 8)}`;
}

function safeJsonParse(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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

function createChunkRing(maxChars) {
  const chunks = [];
  let total = 0;
  return {
    push(text) {
      const v = String(text || '');
      if (!v) return;
      chunks.push(v);
      total += v.length;
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
    }
  };
}

function sendSocket(ws, msg) {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  } catch {
    // ignore
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

function normalizeMultilineList(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function pathInside(child, parent) {
  const c = path.resolve(String(child || ''));
  const p = path.resolve(String(parent || ''));
  if (c === p) return true;
  return c.startsWith(p + path.sep);
}

function nowDateParts() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { y, m, day, ymd: `${y}-${m}${day}` };
}

function spawnSyncText(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: opts.timeout ?? 15_000,
      cwd: opts.cwd,
      env: opts.env,
      maxBuffer: opts.maxBuffer ?? 2 * 1024 * 1024
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

function guessMime(file) {
  const lower = String(file || '').toLowerCase();
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lower.endsWith('.jsonl')) return 'application/x-ndjson; charset=utf-8';
  if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.log')) return 'text/plain; charset=utf-8';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.html')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

function createHarnessFeature(options) {
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
  const HARNESS_WORKSPACE_DIR = path.join(HOME_DIR, 'codex-harness-workspace');
  const HARNESS_DATA_DIR = path.join(DATA_DIR, 'harness');
  const HARNESS_RUNS_DIR = path.join(HARNESS_DATA_DIR, 'runs');
  const HARNESS_ARTIFACTS_DIR = path.join(HARNESS_DATA_DIR, 'artifacts');
  const MAX_SUBTASKS = 3;
  const MAX_RECONNECT_CHARS = 240_000;
  const MAX_HISTORY_RUNS = 100;
  const TERMINAL_CHANNELS = ['orchestrator', 'parent', 'subtask-1', 'subtask-2', 'subtask-3', 'browser-worker'];
  const STAGES = [
    'init',
    'worktree_prepare',
    'artifact_scaffold',
    'parent_plan',
    'subtask_fanout',
    'subtask_collect',
    'parent_integrate',
    'test_verify',
    'self_review',
    'browser_validation',
    'finalize_commit_push'
  ];

  const personas = Array.isArray(DEFAULT_PERSONAS)
    ? DEFAULT_PERSONAS.map((p, index) => ({
        id: slugify(p && p.name ? p.name : `persona-${index + 1}`),
        name: p && p.name ? String(p.name) : `Persona ${index + 1}`,
        voiceId: p && p.voiceId ? String(p.voiceId) : '',
        personality: p && p.personality ? String(p.personality) : ''
      }))
    : [];

  const runs = new Map();

  function ensureRuntimeDirs() {
    ensureDir(SHARED_REPOS_DIR, 0o700);
    ensureDir(HARNESS_WORKSPACE_DIR, 0o700);
    ensureDir(HARNESS_DATA_DIR, 0o700);
    ensureDir(HARNESS_RUNS_DIR, 0o700);
    ensureDir(HARNESS_ARTIFACTS_DIR, 0o700);
  }

  function choosePersona(mode, personaId) {
    const m = String(mode || '').trim() === 'random' ? 'random' : 'selected';
    let persona = null;
    if (m === 'random') {
      if (personas.length) persona = personas[Math.floor(Math.random() * personas.length)] || personas[0];
    } else {
      const target = String(personaId || '').trim();
      persona = personas.find((p) => p.id === target) || personas[0] || null;
    }
    return { mode: m, persona };
  }

  function createChannel(name) {
    return {
      name,
      ring: createChunkRing(MAX_RECONNECT_CHARS),
      sockets: new Set(),
      running: false,
      pid: null,
      startedAt: '',
      exitedAt: '',
      exitCode: null,
      exitSignal: null,
      lastError: '',
      cols: 120,
      rows: 34
    };
  }

  function initStages() {
    return STAGES.map((key) => ({
      key,
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      detail: ''
    }));
  }

  function createRun(task) {
    const runId = randomId('harness');
    const ch = {};
    for (const name of TERMINAL_CHANNELS) ch[name] = createChannel(name);
    const run = {
      id: runId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: '',
      finishedAt: '',
      status: 'created',
      cancelRequested: false,
      currentStage: '',
      error: '',
      task,
      persona: null,
      repo: {
        inputPath: task.repoPath,
        rootPath: '',
        baseBranch: '',
        remote: 'origin'
      },
      worktrees: {
        baseRoot: path.join(HARNESS_WORKSPACE_DIR, 'worktrees', runId),
        parent: null,
        subtasks: []
      },
      channels: ch,
      stages: initStages(),
      artifacts: [],
      artifactSeq: 0,
      summaryText: '',
      finalBranch: '',
      finalCommit: '',
      pushResult: null,
      subtaskResults: [],
      activeJobs: new Map(),
      logsFile: '',
      browser: {
        scenarios: task.browserScenarios || [],
        attempts: 0,
        lastResult: null
      }
    };
    run.logsFile = path.join(HARNESS_ARTIFACTS_DIR, run.id, 'orchestrator.log');
    runs.set(run.id, run);
    persistRun(run);
    return run;
  }

  function channelSummary(run, name) {
    const ch = run.channels[name];
    if (!ch) return null;
    return {
      name,
      running: ch.running,
      pid: ch.pid,
      startedAt: ch.startedAt || null,
      exitedAt: ch.exitedAt || null,
      exitCode: ch.exitCode,
      exitSignal: ch.exitSignal,
      lastError: ch.lastError || null,
      clients: ch.sockets.size
    };
  }

  function runSnapshot(run) {
    return {
      id: run.id,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt || null,
      finishedAt: run.finishedAt || null,
      status: run.status,
      currentStage: run.currentStage || null,
      cancelRequested: run.cancelRequested,
      error: run.error || null,
      task: {
        title: run.task.title,
        repoPath: run.task.repoPath,
        objective: run.task.objective,
        successCriteria: run.task.successCriteria,
        constraints: run.task.constraints,
        subtaskCount: run.task.subtaskCount,
        verificationCommands: run.task.verificationCommands,
        browserScenarios: run.task.browserScenarios,
        personaMode: run.task.personaMode,
        personaId: run.task.personaId
      },
      persona: run.persona,
      repo: run.repo,
      worktrees: run.worktrees,
      stages: run.stages,
      terminals: TERMINAL_CHANNELS.map((name) => channelSummary(run, name)).filter(Boolean),
      artifacts: run.artifacts,
      summaryText: run.summaryText || '',
      finalBranch: run.finalBranch || '',
      finalCommit: run.finalCommit || '',
      pushResult: run.pushResult,
      subtaskResults: run.subtaskResults,
      browser: run.browser
    };
  }

  function persistRun(run) {
    try {
      ensureRuntimeDirs();
      const file = path.join(HARNESS_RUNS_DIR, `${run.id}.json`);
      const tmp = `${file}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(runSnapshot(run), null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, file);
      fs.chmodSync(file, 0o600);
    } catch {
      // persistence must not crash active runs.
    }
  }

  function listRunSnapshots() {
    ensureRuntimeDirs();
    const byId = new Map();
    for (const run of runs.values()) {
      byId.set(run.id, runSnapshot(run));
    }
    let files = [];
    try {
      files = fs.readdirSync(HARNESS_RUNS_DIR).filter((f) => f.endsWith('.json'));
    } catch {
      files = [];
    }
    for (const name of files) {
      const id = name.slice(0, -5);
      if (byId.has(id)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(HARNESS_RUNS_DIR, name), 'utf8'));
        if (parsed && parsed.id) byId.set(parsed.id, parsed);
      } catch {
        // ignore corrupt files
      }
    }
    return Array.from(byId.values())
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
      .slice(0, MAX_HISTORY_RUNS);
  }

  function appendChannel(run, channelName, text) {
    const ch = run.channels[channelName];
    if (!ch) return;
    const value = String(text || '');
    if (!value) return;
    ch.ring.push(value);
    ch.lastError = '';
    run.updatedAt = nowIso();

    // Mirror orchestrator logs to a file for historical inspection.
    try {
      if (channelName === 'orchestrator') {
        const file = path.join(HARNESS_ARTIFACTS_DIR, run.id, 'orchestrator.log');
        ensureDir(path.dirname(file), 0o700);
        fs.appendFileSync(file, stripAnsi(value), { encoding: 'utf8', mode: 0o600 });
      }
    } catch {
      // ignore
    }

    const msg = { type: 'output', runId: run.id, channel: channelName, data: value };
    for (const ws of ch.sockets) sendSocket(ws, msg);
    broadcastRunState(run);
    persistRun(run);
  }

  function broadcastRunState(run) {
    const payload = { type: 'run_state', runId: run.id, run: runSnapshot(run) };
    for (const name of TERMINAL_CHANNELS) {
      const ch = run.channels[name];
      if (!ch) continue;
      for (const ws of ch.sockets) sendSocket(ws, payload);
    }
  }

  function markStage(run, key, status, detail = '') {
    const stage = run.stages.find((s) => s.key === key);
    if (!stage) return;
    const now = nowIso();
    if (status === 'running') {
      stage.status = 'running';
      stage.startedAt = stage.startedAt || now;
      stage.detail = detail || stage.detail || '';
      run.currentStage = key;
    } else {
      stage.status = status;
      if (!stage.startedAt) stage.startedAt = now;
      stage.finishedAt = now;
      stage.detail = detail || stage.detail || '';
      try {
        stage.durationMs = new Date(stage.finishedAt).getTime() - new Date(stage.startedAt).getTime();
      } catch {
        stage.durationMs = null;
      }
      if (run.currentStage === key) run.currentStage = '';
    }
    run.updatedAt = now;
    broadcastRunState(run);
    persistRun(run);
  }

  function stageSkip(run, key, detail = '') {
    const stage = run.stages.find((s) => s.key === key);
    if (!stage) return;
    stage.status = 'skipped';
    stage.startedAt = stage.startedAt || nowIso();
    stage.finishedAt = nowIso();
    stage.detail = detail;
    run.updatedAt = nowIso();
    broadcastRunState(run);
    persistRun(run);
  }

  function artifactBaseDir(run) {
    return path.join(HARNESS_ARTIFACTS_DIR, run.id);
  }

  function registerArtifact(run, relPath, meta = {}) {
    const full = path.join(artifactBaseDir(run), relPath);
    let stat = null;
    try {
      stat = fs.statSync(full);
    } catch {
      stat = null;
    }
    const item = {
      id: `a${String(++run.artifactSeq).padStart(4, '0')}`,
      name: meta.name || path.basename(relPath),
      relPath,
      type: meta.type || 'file',
      mime: meta.mime || guessMime(relPath),
      size: stat ? stat.size : null,
      createdAt: nowIso(),
      description: meta.description || ''
    };
    run.artifacts.push(item);
    run.updatedAt = nowIso();
    persistRun(run);
    return item;
  }

  function writeTextArtifact(run, relPath, content, meta = {}) {
    const file = path.join(artifactBaseDir(run), relPath);
    ensureDir(path.dirname(file), 0o700);
    fs.writeFileSync(file, String(content || ''), { encoding: 'utf8', mode: 0o600 });
    return registerArtifact(run, relPath, { ...meta, type: 'text', mime: meta.mime || guessMime(file) });
  }

  function writeJsonArtifact(run, relPath, obj, meta = {}) {
    return writeTextArtifact(run, relPath, JSON.stringify(obj, null, 2) + '\n', {
      ...meta,
      type: 'json',
      mime: 'application/json; charset=utf-8'
    });
  }

  function registerExistingArtifact(run, fullPath, meta = {}) {
    const root = artifactBaseDir(run);
    if (!pathInside(fullPath, root)) throw new Error('artifact outside harness root');
    const rel = path.relative(root, fullPath).replace(/\\/g, '/');
    return registerArtifact(run, rel, meta);
  }

  function parseCodexAuthStatus() {
    const r = spawnSyncText('codex', ['login', 'status']);
    const text = `${r.stdout}${r.stderr}`.trim();
    if (/logged in/i.test(text)) return { status: 'logged_in', detail: text.split(/\r?\n/)[0] || text };
    if (/not logged/i.test(text)) return { status: 'logged_out', detail: text.split(/\r?\n/)[0] || text };
    if (!r.ok) return { status: 'unknown', detail: r.error || text || `exit ${r.status}` };
    return { status: 'unknown', detail: text.split(/\r?\n/)[0] || '' };
  }

  function codexVersion() {
    const r = spawnSyncText('codex', ['--version']);
    return (`${r.stdout}${r.stderr}`.trim() || null);
  }

  function harnessConfig() {
    ensureRuntimeDirs();
    const browser = detectPlaywright();
    return {
      ok: true,
      now: nowIso(),
      limits: {
        maxSubtasks: MAX_SUBTASKS,
        channels: TERMINAL_CHANNELS.slice(),
        stages: STAGES.slice()
      },
      paths: {
        homeDir: HOME_DIR,
        sharedReposDir: SHARED_REPOS_DIR,
        harnessWorkspaceDir: HARNESS_WORKSPACE_DIR,
        harnessDataDir: HARNESS_DATA_DIR
      },
      dependencies: {
        ws: Boolean(WebSocketServerCtor),
        nodePty: Boolean(pty),
        codex: Boolean(codexVersion()),
        playwright: browser.installed,
        chromium: Boolean(browser.chromiumPath)
      },
      codex: {
        version: codexVersion(),
        authStatus: parseCodexAuthStatus()
      },
      browser,
      personas: personas.map((p) => ({ id: p.id, name: p.name, voiceId: p.voiceId || '' }))
    };
  }

  function chooseRunOrThrow(runId) {
    const run = runs.get(String(runId || ''));
    if (!run) throw new Error('run not found');
    return run;
  }

  async function readJsonBody(req) {
    const raw = await readBody(req, 1024 * 1024);
    if (!raw) return {};
    const parsed = safeJsonParse(raw);
    if (!parsed.ok) throw new Error('invalid json');
    return parsed.value && typeof parsed.value === 'object' ? parsed.value : {};
  }

  function normalizeTaskInput(body) {
    const title = String(body.title || '').trim();
    const repoPath = String(body.repoPath || '').trim();
    const objective = String(body.objective || '').trim();
    const successCriteria = String(body.successCriteria || '').trim();
    const constraints = String(body.constraints || '').trim();
    const baseBranch = String(body.baseBranch || '').trim();
    const subtaskCount = clampInt(body.subtaskCount, 0, MAX_SUBTASKS, 0);

    if (!title) throw new Error('missing title');
    if (!repoPath) throw new Error('missing repoPath');
    if (!objective) throw new Error('missing objective');

    const verificationCommands = Array.isArray(body.verificationCommands)
      ? body.verificationCommands.map((v) => String(v || '').trim()).filter(Boolean)
      : normalizeMultilineList(body.verificationCommandsText || body.verificationCommands || '');

    let browserScenarios = [];
    if (Array.isArray(body.browserScenarios)) {
      browserScenarios = body.browserScenarios;
    } else if (typeof body.browserScenariosJson === 'string' && body.browserScenariosJson.trim()) {
      const parsed = safeJsonParse(body.browserScenariosJson);
      if (!parsed.ok) throw new Error(`invalid browserScenariosJson: ${parsed.error}`);
      browserScenarios = parsed.value;
    } else if (typeof body.browserScenarioUrls === 'string' && body.browserScenarioUrls.trim()) {
      browserScenarios = normalizeMultilineList(body.browserScenarioUrls).map((url, idx) => ({
        name: `Scenario ${idx + 1}`,
        url
      }));
    }
    browserScenarios = normalizeScenarios(browserScenarios).slice(0, 12);

    let subtaskPrompts = [];
    if (Array.isArray(body.subtaskPrompts)) {
      subtaskPrompts = body.subtaskPrompts.map((v) => String(v || '').trim()).filter(Boolean);
    } else if (typeof body.subtaskPromptsText === 'string') {
      subtaskPrompts = body.subtaskPromptsText
        .split(/\n\s*---+\s*\n/g)
        .map((v) => String(v || '').trim())
        .filter(Boolean);
    }
    subtaskPrompts = subtaskPrompts.slice(0, MAX_SUBTASKS);

    const personaMode = String(body.personaMode || 'selected').trim() === 'random' ? 'random' : 'selected';
    const personaId = String(body.personaId || '').trim();

    return {
      title,
      repoPath,
      objective,
      successCriteria,
      constraints,
      baseBranch,
      verificationCommands,
      browserScenarios,
      subtaskCount,
      subtaskPrompts,
      personaMode,
      personaId
    };
  }

  function resolveRepoPath(inputPath) {
    ensureRuntimeDirs();
    const raw = String(inputPath || '').trim();
    if (!raw) throw new Error('missing repoPath');
    const abs = path.resolve(raw.startsWith('/') ? raw : path.join(SHARED_REPOS_DIR, raw));
    if (!pathInside(abs, SHARED_REPOS_DIR)) {
      throw new Error(`repoPath must be inside ${SHARED_REPOS_DIR}`);
    }
    if (!fs.existsSync(abs)) throw new Error(`repoPath not found: ${abs}`);

    const top = spawnSyncText('git', ['-C', abs, 'rev-parse', '--show-toplevel'], { timeout: 10000 });
    if (!top.ok) throw new Error(`not a git repo: ${abs}`);
    const root = String(top.stdout || '').trim();
    if (!root || !fs.existsSync(root)) throw new Error('unable to resolve git repo root');
    if (!pathInside(root, SHARED_REPOS_DIR)) throw new Error('git repo root is outside shared-repos');
    return root;
  }

  function gitCurrentBranch(repoRoot) {
    const r = spawnSyncText('git', ['-C', repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD']);
    if (!r.ok) return 'main';
    const branch = String(r.stdout || '').trim();
    return branch && branch !== 'HEAD' ? branch : 'main';
  }

  function gitStatusPorcelain(repoRoot) {
    const r = spawnSyncText('git', ['-C', repoRoot, 'status', '--porcelain']);
    if (!r.ok) return { ok: false, lines: [], raw: `${r.stdout}${r.stderr}`.trim() || r.error || 'git status failed' };
    const lines = String(r.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    return { ok: true, lines, raw: String(r.stdout || '') };
  }

  function makeBranchName(run, suffix = '') {
    const { ymd } = nowDateParts();
    const slug = slugify(run.task.title).slice(0, 40);
    const base = `harness/${ymd}/${slug}-${run.id.slice(-6)}`;
    return suffix ? `${base}-${suffix}` : base;
  }

  function ensureNoCancel(run) {
    if (run.cancelRequested) {
      const err = new Error('cancelled');
      err.code = 'CANCELLED';
      throw err;
    }
  }

  function channelSetRunning(run, name, running, info = {}) {
    const ch = run.channels[name];
    if (!ch) return;
    ch.running = running;
    if (running) {
      ch.startedAt = nowIso();
      ch.pid = info.pid ?? null;
      ch.exitCode = null;
      ch.exitSignal = null;
      ch.exitedAt = '';
      ch.lastError = '';
    } else {
      ch.pid = null;
      ch.exitedAt = nowIso();
      if (Object.prototype.hasOwnProperty.call(info, 'exitCode')) ch.exitCode = info.exitCode;
      if (Object.prototype.hasOwnProperty.call(info, 'exitSignal')) ch.exitSignal = info.exitSignal;
      if (info.error) ch.lastError = String(info.error);
    }
    broadcastRunState(run);
    persistRun(run);
  }

  function shellEscapeSingle(raw) {
    return `'${String(raw || '').replace(/'/g, `'\\''`)}'`;
  }

  function ptyEnv() {
    return {
      ...process.env,
      HOME: HOME_DIR,
      TERM: 'xterm-256color'
    };
  }

  function registerActiveJob(run, id, killFn) {
    run.activeJobs.set(id, { kill: killFn });
    persistRun(run);
  }

  function unregisterActiveJob(run, id) {
    run.activeJobs.delete(id);
    persistRun(run);
  }

  function killActiveJobs(run) {
    for (const [id, job] of Array.from(run.activeJobs.entries())) {
      try {
        if (job && typeof job.kill === 'function') job.kill();
      } catch {
        // ignore
      }
      run.activeJobs.delete(id);
    }
    broadcastRunState(run);
    persistRun(run);
  }

  function runPtyCommand(run, channelName, cmd, args, cwd, options = {}) {
    if (!pty) return Promise.reject(new Error('node-pty dependency is not installed'));
    ensureNoCancel(run);

    const ch = run.channels[channelName];
    if (!ch) return Promise.reject(new Error(`unknown channel: ${channelName}`));

    return new Promise((resolve, reject) => {
      let proc;
      let finished = false;
      let rawOut = '';
      let plainOut = '';
      const jobId = randomId(`job-${channelName}`);

      try {
        proc = pty.spawn(cmd, args, {
          name: 'xterm-256color',
          cwd,
          cols: ch.cols || 120,
          rows: ch.rows || 34,
          env: { ...ptyEnv(), ...(options.env || {}) }
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }

      channelSetRunning(run, channelName, true, { pid: proc.pid });
      appendChannel(run, channelName, `\r\n[harness] spawn: ${cmd} ${args.join(' ')}\r\n`);

      const killFn = () => {
        try {
          proc.kill('SIGTERM');
        } catch {
          // ignore
        }
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, 1200);
      };
      registerActiveJob(run, jobId, killFn);

      proc.onData((data) => {
        const text = String(data || '');
        if (!text) return;
        rawOut += text;
        plainOut += stripAnsi(text);
        if (rawOut.length > 2_000_000) rawOut = rawOut.slice(-2_000_000);
        if (plainOut.length > 2_000_000) plainOut = plainOut.slice(-2_000_000);
        appendChannel(run, channelName, text);
      });

      proc.onExit((evt) => {
        if (finished) return;
        finished = true;
        unregisterActiveJob(run, jobId);
        const code = evt && Number.isFinite(evt.exitCode) ? evt.exitCode : null;
        const signal = evt && evt.signal != null ? String(evt.signal) : null;
        channelSetRunning(run, channelName, false, { exitCode: code, exitSignal: signal });
        if (code !== 0 && !options.allowNonZero) {
          const err = new Error(`${cmd} exited with code ${code ?? 'unknown'}`);
          err.code = 'CMD_EXIT';
          err.exitCode = code;
          err.signal = signal;
          err.output = plainOut;
          reject(err);
          return;
        }
        resolve({ code, signal, raw: rawOut, plain: plainOut });
      });
    });
  }

  async function runShellInParent(run, command, label, allowNonZero = false) {
    ensureNoCancel(run);
    const cwd = run.worktrees.parent?.path;
    if (!cwd) throw new Error('parent worktree is not ready');
    appendChannel(run, 'orchestrator', `[shell] ${label}: ${command}\n`);
    return runPtyCommand(run, 'parent', '/bin/bash', ['-lc', command], cwd, { allowNonZero });
  }

  async function runCodexExec(run, channelName, cwd, prompt, label) {
    ensureNoCancel(run);
    appendChannel(run, 'orchestrator', `[codex] ${label} (${channelName})\n`);
    const args = [
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '-C',
      cwd,
      '--add-dir',
      HOME_DIR,
      '--add-dir',
      SHARED_REPOS_DIR,
      '--color',
      'never',
      String(prompt || '')
    ];
    return runPtyCommand(run, channelName, 'codex', args, cwd, { allowNonZero: false });
  }

  function stageFile(run, relPath) {
    return path.join(artifactBaseDir(run), relPath);
  }

  function appendJournal(run, text) {
    const file = path.join(run.worktrees.parent?.path || artifactBaseDir(run), 'docs', 'harness', 'run-journal.md');
    try {
      ensureDir(path.dirname(file), 0o700);
      fs.appendFileSync(file, `\n${String(text || '').trim()}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // ignore
    }
  }

  function generateTaskSpec(run) {
    const t = run.task;
    const p = run.persona || { name: 'Default', personality: '' };
    const lines = [];
    lines.push(`# Harness Task Spec: ${t.title}`);
    lines.push('');
    lines.push(`- Run ID: \`${run.id}\``);
    lines.push(`- Repo: \`${run.repo.rootPath || t.repoPath}\``);
    lines.push(`- Base Branch: \`${run.repo.baseBranch || t.baseBranch || ''}\``);
    lines.push(`- Parent Branch: \`${run.finalBranch || '(pending)'}\``);
    lines.push(`- Persona Liaison: ${p.name || 'None'}`);
    lines.push(`- Subtasks: ${t.subtaskCount}`);
    lines.push('');
    lines.push('## Objective');
    lines.push(t.objective || '');
    lines.push('');
    lines.push('## Success Criteria');
    lines.push(t.successCriteria || '- Define explicit acceptance criteria before execution.');
    lines.push('');
    lines.push('## Constraints');
    lines.push(t.constraints || '- Preserve existing behavior outside scope.');
    lines.push('');
    lines.push('## Verification Commands');
    if (t.verificationCommands.length) {
      for (const cmd of t.verificationCommands) lines.push(`- \`${cmd}\``);
    } else {
      lines.push('- (none provided)');
    }
    lines.push('');
    lines.push('## Browser Validation Scenarios');
    if (t.browserScenarios.length) {
      for (const s of t.browserScenarios) lines.push(`- ${s.name}: ${s.url}`);
    } else {
      lines.push('- (none)');
    }
    lines.push('');
    if (p.personality) {
      lines.push('## Persona Style Guide (Liaison)');
      lines.push(p.personality);
      lines.push('');
    }
    return lines.join('\n') + '\n';
  }

  function generateAgentsMd(run) {
    const t = run.task;
    const persona = run.persona || { name: 'Default', personality: '' };
    const subtaskPaths = (run.worktrees.subtasks || []).map((s) => `- ${s.name}: \`${s.path}\``);
    return [
      '# AGENTS.md',
      '',
      '## Harness Engineering Workflow',
      '- Source of truth: `docs/harness/task-spec.md`',
      '- Review checklist: `docs/harness/review-checklist.md`',
      '- Verification plan: `docs/harness/verification-plan.md`',
      '- Run journal: `docs/harness/run-journal.md`',
      '',
      '## Working Conventions',
      '- Prefer small, reviewable commits while iterating locally (final harness stage may squash into a single commit).',
      '- Preserve existing behavior outside explicit task scope.',
      '- Record assumptions and unresolved issues in the run journal.',
      '',
      `## Liaison Persona`,
      `- Selected mode: ${run.task.personaMode}`,
      `- Persona: ${persona.name || 'None'}`,
      ...(persona.personality ? [`- Style guide: ${persona.personality}`] : []),
      '',
      '## Harness Paths',
      `- Parent worktree: \`${run.worktrees.parent?.path || '(pending)'}\``,
      `- Shared repos root: \`${SHARED_REPOS_DIR}\``,
      ...subtaskPaths,
      '',
      '## Task Summary',
      `- Title: ${t.title}`,
      `- Objective: ${t.objective}`,
      ''
    ].join('\n');
  }

  function generateReviewChecklist(run) {
    return [
      '# Harness Review Checklist',
      '',
      '- [ ] Task objective addressed',
      '- [ ] Success criteria validated',
      '- [ ] Out-of-scope areas unchanged',
      '- [ ] Verification commands run and results captured',
      '- [ ] Browser validation (if configured) passed or failures documented',
      '- [ ] Docs/comments updated where behavior changed',
      '- [ ] Final branch pushed to origin',
      ''
    ].join('\n');
  }

  function generateVerificationPlan(run) {
    const commands = run.task.verificationCommands.length ? run.task.verificationCommands : ['# Add verification commands'];
    return ['# Verification Plan', '', ...commands.map((c) => `- \`${c}\``), ''].join('\n');
  }

  function generateSubtaskPrompt(run, index) {
    const explicit = run.task.subtaskPrompts[index - 1];
    if (explicit) return explicit;
    return [
      `Subtask ${index} for harness run ${run.id}.`,
      `Task title: ${run.task.title}`,
      `Objective: ${run.task.objective}`,
      'Read docs/harness/task-spec.md and docs/harness/subtasks/subtask-' + index + '.md if present.',
      'Implement a meaningful subset of the task in this subtask worktree.',
      'Prefer focused file changes. Run relevant checks if obvious. Summarize what you changed and any risks.'
    ].join('\n');
  }

  function generateParentPlanPrompt(run) {
    const persona = run.persona || { name: 'Default', personality: '' };
    return [
      `Harness Engineering parent planning stage for run ${run.id}.`,
      `You are operating inside the parent worktree for branch ${run.finalBranch}.`,
      'Read docs/harness/task-spec.md, AGENTS.md, and docs/harness/verification-plan.md.',
      'Produce an execution plan in docs/harness/parent-plan.md with clear steps, risks, and file targets.',
      'Also append a short plan summary to docs/harness/run-journal.md.',
      persona.personality ? `Liaison persona style (for written docs only): ${persona.personality}` : '',
      'Then implement any repo reconnaissance commands needed and leave the repository ready for subtask fanout.'
    ].filter(Boolean).join('\n');
  }

  function generateParentIntegratePrompt(run) {
    const subtaskLines = (run.worktrees.subtasks || [])
      .map((s) => `- ${s.name}: ${s.path}`)
      .join('\n');
    return [
      `Harness parent integration stage for run ${run.id}.`,
      'Integrate results from subtask worktrees into this parent worktree.',
      'Review the subtask result artifacts under docs/harness/subtasks and .pi5-dashboard-data artifacts if needed.',
      'Subtask worktrees:',
      subtaskLines || '- none',
      'Apply or replicate the best changes into the parent worktree, resolve conflicts, and update docs/harness/run-journal.md with an integration summary.'
    ].join('\n');
  }

  function generateSelfReviewPrompt(run) {
    return [
      `Harness self-review stage for run ${run.id}.`,
      'Review the current parent worktree changes against docs/harness/task-spec.md and docs/harness/review-checklist.md.',
      'Patch any issues you find, especially correctness, regressions, and missing verification/doc updates.',
      'Append a concise self-review summary to docs/harness/run-journal.md.'
    ].join('\n');
  }

  function generateRepairPrompt(run, reason) {
    return [
      `Harness repair pass for run ${run.id}.`,
      `Reason: ${reason}`,
      'Inspect the failing outputs/artifacts and patch the parent worktree to resolve the issue.',
      'Re-run any minimal checks needed to confirm the fix, and append what changed to docs/harness/run-journal.md.'
    ].join('\n');
  }

  function summarizeRunDeterministic(run) {
    const lines = [];
    lines.push(`Harness run ${run.id}: ${run.task.title}`);
    lines.push(`Status: ${run.status}`);
    if (run.repo.rootPath) lines.push(`Repo: ${run.repo.rootPath}`);
    if (run.finalBranch) lines.push(`Branch: ${run.finalBranch}`);
    if (run.finalCommit) lines.push(`Commit: ${run.finalCommit}`);
    const failed = run.stages.find((s) => s.status === 'failed');
    if (failed) lines.push(`Failed stage: ${failed.key} (${failed.detail || 'no detail'})`);
    const completed = run.stages.filter((s) => s.status === 'completed').length;
    const skipped = run.stages.filter((s) => s.status === 'skipped').length;
    lines.push(`Stages completed: ${completed}/${run.stages.length} (skipped ${skipped})`);
    if (Array.isArray(run.task.verificationCommands) && run.task.verificationCommands.length) {
      lines.push(`Verification commands: ${run.task.verificationCommands.length}`);
    }
    if (Array.isArray(run.task.browserScenarios) && run.task.browserScenarios.length) {
      lines.push(`Browser scenarios: ${run.task.browserScenarios.length}`);
      if (run.browser && run.browser.lastResult) {
        lines.push(`Browser validation ok: ${Boolean(run.browser.lastResult.ok)}`);
      }
    }
    if (run.pushResult && run.pushResult.ok === true) lines.push('Push: succeeded');
    else if (run.pushResult && run.pushResult.ok === false) lines.push('Push: failed');
    return lines.join('\n');
  }

  async function maybeEnhanceSummaryWithGemini(run, text) {
    const env = readEnvMap();
    const key = String(env.GEMINI_API_KEY || '').trim();
    if (!key || typeof callGemini !== 'function') return text;
    try {
      const prompt = [
        'Rewrite the following harness run summary into a concise technical briefing with bullet points.',
        'Do not invent facts. Keep it under 180 words.',
        '',
        text
      ].join('\n');
      const out = String(await callGemini(key, prompt)).trim();
      return out || text;
    } catch {
      return text;
    }
  }

  async function finalizeRunSummary(run) {
    let summary = summarizeRunDeterministic(run);
    summary = await maybeEnhanceSummaryWithGemini(run, summary);
    run.summaryText = summary;
    writeTextArtifact(run, 'summary/final-summary.txt', summary + '\n', {
      name: 'Final Summary',
      description: 'Harness run summary generated at completion.'
    });
    persistRun(run);
    broadcastRunState(run);
  }

  async function stageInit(run) {
    ensureRuntimeDirs();
    run.persona = choosePersona(run.task.personaMode, run.task.personaId).persona;
    run.repo.rootPath = resolveRepoPath(run.task.repoPath);
    run.repo.baseBranch = run.task.baseBranch || gitCurrentBranch(run.repo.rootPath);
    ensureDir(run.worktrees.baseRoot, 0o700);
    ensureDir(artifactBaseDir(run), 0o700);
    appendChannel(run, 'orchestrator', `[init] repo root: ${run.repo.rootPath}\n`);
    appendChannel(run, 'orchestrator', `[init] base branch: ${run.repo.baseBranch}\n`);
    appendChannel(run, 'orchestrator', `[init] codex version: ${codexVersion() || 'unknown'}\n`);
    appendChannel(run, 'orchestrator', `[init] codex auth: ${parseCodexAuthStatus().status}\n`);
    writeJsonArtifact(run, 'metadata/config.json', harnessConfig(), { name: 'Harness Config Snapshot' });
  }

  async function stageWorktreePrepare(run) {
    const clean = gitStatusPorcelain(run.repo.rootPath);
    if (!clean.ok) throw new Error(clean.raw || 'git status failed');
    if (clean.lines.length) {
      throw new Error(`base repo has uncommitted changes (${clean.lines.length} entries); clean it before running harness`);
    }

    run.finalBranch = makeBranchName(run);
    const parentPath = path.join(run.worktrees.baseRoot, 'parent');
    run.worktrees.parent = { name: 'parent', path: parentPath, branch: run.finalBranch };

    const addParent = spawnSyncText('git', ['-C', run.repo.rootPath, 'worktree', 'add', '-b', run.finalBranch, parentPath, run.repo.baseBranch], {
      timeout: 120_000
    });
    if (!addParent.ok) throw new Error(`git worktree add parent failed: ${(`${addParent.stdout}${addParent.stderr}`.trim() || addParent.error)}`);
    appendChannel(run, 'orchestrator', `[worktree] parent created: ${parentPath} (${run.finalBranch})\n`);

    run.worktrees.subtasks = [];
    for (let i = 1; i <= run.task.subtaskCount; i += 1) {
      const branch = makeBranchName(run, `sub${i}`);
      const wpath = path.join(run.worktrees.baseRoot, `subtask-${i}`);
      const r = spawnSyncText('git', ['-C', run.repo.rootPath, 'worktree', 'add', '-b', branch, wpath, run.repo.baseBranch], {
        timeout: 120_000
      });
      if (!r.ok) throw new Error(`git worktree add subtask-${i} failed: ${(`${r.stdout}${r.stderr}`.trim() || r.error)}`);
      run.worktrees.subtasks.push({ name: `subtask-${i}`, path: wpath, branch });
      appendChannel(run, 'orchestrator', `[worktree] subtask-${i} created: ${wpath} (${branch})\n`);
    }

    persistRun(run);
  }

  async function stageArtifactScaffold(run) {
    const parentRoot = run.worktrees.parent?.path;
    if (!parentRoot) throw new Error('parent worktree missing');

    const docsDir = path.join(parentRoot, 'docs', 'harness');
    ensureDir(docsDir, 0o700);
    ensureDir(path.join(docsDir, 'subtasks'), 0o700);

    const taskSpec = generateTaskSpec(run);
    const agentsMd = generateAgentsMd(run);
    const journal = `# Harness Run Journal\n\n- Run ID: ${run.id}\n- Created: ${run.createdAt}\n- Status: ${run.status}\n`;
    const checklist = generateReviewChecklist(run);
    const verificationPlan = generateVerificationPlan(run);

    fs.writeFileSync(path.join(parentRoot, 'AGENTS.md'), agentsMd, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(path.join(docsDir, 'task-spec.md'), taskSpec, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(path.join(docsDir, 'run-journal.md'), journal, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(path.join(docsDir, 'review-checklist.md'), checklist, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(path.join(docsDir, 'verification-plan.md'), verificationPlan, { encoding: 'utf8', mode: 0o600 });

    for (let i = 1; i <= run.task.subtaskCount; i += 1) {
      const subtaskDoc = [
        `# Subtask ${i}`,
        '',
        `Run ID: ${run.id}`,
        `Parent task: ${run.task.title}`,
        '',
        'Scope:',
        run.task.subtaskPrompts[i - 1] || `Liaison-generated subtask ${i} prompt applies.`,
        ''
      ].join('\n');
      fs.writeFileSync(path.join(docsDir, 'subtasks', `subtask-${i}.md`), subtaskDoc, { encoding: 'utf8', mode: 0o600 });
    }

    writeTextArtifact(run, 'docs/AGENTS.md', agentsMd, { name: 'AGENTS.md' });
    writeTextArtifact(run, 'docs/task-spec.md', taskSpec, { name: 'Task Spec' });
    writeTextArtifact(run, 'docs/run-journal.md', journal, { name: 'Run Journal' });
    writeTextArtifact(run, 'docs/review-checklist.md', checklist, { name: 'Review Checklist' });
    writeTextArtifact(run, 'docs/verification-plan.md', verificationPlan, { name: 'Verification Plan' });
    for (let i = 1; i <= run.task.subtaskCount; i += 1) {
      const full = path.join(parentRoot, 'docs', 'harness', 'subtasks', `subtask-${i}.md`);
      registerExistingArtifact(run, full.replace(parentRoot + path.sep, artifactBaseDir(run) + path.sep), { name: `Subtask ${i} Doc` });
    }

    appendChannel(run, 'orchestrator', '[artifacts] scaffolded harness docs in parent worktree\n');
    appendJournal(run, `## Artifact Scaffold\nGenerated task spec and harness docs at ${nowIso()}.`);
  }

  async function stageParentPlan(run) {
    const cwd = run.worktrees.parent?.path;
    if (!cwd) throw new Error('parent worktree missing');
    const result = await runCodexExec(run, 'parent', cwd, generateParentPlanPrompt(run), 'parent plan');
    writeTextArtifact(run, 'codex/parent-plan-stage.txt', result.plain || '', { name: 'Parent Plan Stage Output' });
    appendJournal(run, `## Parent Plan\nCodex parent planning stage completed at ${nowIso()}.`);
  }

  async function stageSubtaskFanout(run) {
    if (!run.task.subtaskCount) {
      stageSkip(run, 'subtask_fanout', 'No subtasks configured');
      return 'skipped';
    }

    const jobs = run.worktrees.subtasks.slice(0, run.task.subtaskCount).map((sub, idx) =>
      (async () => {
        const channel = `subtask-${idx + 1}`;
        const prompt = generateSubtaskPrompt(run, idx + 1);
        try {
          const result = await runCodexExec(run, channel, sub.path, prompt, `subtask ${idx + 1}`);
          const artifact = writeTextArtifact(run, `codex/${channel}-output.txt`, result.plain || '', {
            name: `Subtask ${idx + 1} Codex Output`
          });
          return { ok: true, channel, worktree: sub, artifactId: artifact.id };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          writeTextArtifact(run, `codex/${channel}-error.txt`, msg + '\n', { name: `Subtask ${idx + 1} Error` });
          return { ok: false, channel, worktree: sub, error: msg };
        }
      })()
    );

    run.subtaskResults = await Promise.all(jobs);
    writeJsonArtifact(run, 'codex/subtask-fanout-results.json', run.subtaskResults, { name: 'Subtask Fanout Results' });

    if (run.subtaskResults.some((r) => !r.ok)) {
      throw new Error('One or more subtasks failed');
    }
  }

  async function stageSubtaskCollect(run) {
    if (!run.task.subtaskCount) {
      stageSkip(run, 'subtask_collect', 'No subtasks configured');
      return 'skipped';
    }

    const summary = [];
    for (let i = 0; i < run.worktrees.subtasks.length; i += 1) {
      const sub = run.worktrees.subtasks[i];
      const status = gitStatusPorcelain(sub.path);
      const diffNames = spawnSyncText('git', ['-C', sub.path, 'diff', '--name-only']);
      summary.push({
        name: sub.name,
        branch: sub.branch,
        path: sub.path,
        statusOk: status.ok,
        statusLines: status.lines,
        changedFiles: String(diffNames.stdout || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      });
      fs.writeFileSync(
        path.join(run.worktrees.parent.path, 'docs', 'harness', 'subtasks', `${sub.name}-status.json`),
        JSON.stringify(summary[summary.length - 1], null, 2) + '\n',
        { encoding: 'utf8', mode: 0o600 }
      );
    }
    writeJsonArtifact(run, 'codex/subtask-collect-summary.json', summary, { name: 'Subtask Collect Summary' });
    appendJournal(run, `## Subtask Collect\nCollected subtask summaries for ${summary.length} subtasks.`);
  }

  async function stageParentIntegrate(run) {
    const cwd = run.worktrees.parent?.path;
    if (!cwd) throw new Error('parent worktree missing');
    if (!run.task.subtaskCount) {
      stageSkip(run, 'parent_integrate', 'No subtasks configured');
      return 'skipped';
    }
    const result = await runCodexExec(run, 'parent', cwd, generateParentIntegratePrompt(run), 'parent integrate');
    writeTextArtifact(run, 'codex/parent-integrate-stage.txt', result.plain || '', { name: 'Parent Integrate Output' });
    appendJournal(run, `## Parent Integrate\nIntegration stage completed at ${nowIso()}.`);
  }

  async function runVerificationCommands(run, commands, attemptLabel) {
    const results = [];
    for (const cmd of commands) {
      ensureNoCancel(run);
      const out = await runShellInParent(run, cmd, `${attemptLabel}: ${cmd}`, true);
      const ok = (out.code || 0) === 0;
      results.push({ command: cmd, ok, code: out.code, signal: out.signal, output: (out.plain || '').slice(-5000) });
    }
    return results;
  }

  async function stageTestVerify(run) {
    const commands = run.task.verificationCommands || [];
    if (!commands.length) {
      stageSkip(run, 'test_verify', 'No verification commands configured');
      return 'skipped';
    }

    let results = await runVerificationCommands(run, commands, 'verify-1');
    writeJsonArtifact(run, 'verify/attempt-1.json', results, { name: 'Verification Attempt 1' });
    const failed = results.filter((r) => !r.ok);
    if (!failed.length) {
      appendJournal(run, `## Verification\nAll verification commands passed on first attempt.`);
      return;
    }

    appendChannel(run, 'orchestrator', `[verify] ${failed.length} command(s) failed; running one Codex repair pass\n`);
    await runCodexExec(run, 'parent', run.worktrees.parent.path, generateRepairPrompt(run, 'verification command failures'), 'verification repair');

    const rerunCommands = failed.map((f) => f.command);
    const attempt2 = await runVerificationCommands(run, rerunCommands, 'verify-2');
    writeJsonArtifact(run, 'verify/attempt-2.json', attempt2, { name: 'Verification Attempt 2' });
    if (attempt2.some((r) => !r.ok)) {
      throw new Error('verification commands still failing after repair pass');
    }
    appendJournal(run, `## Verification\nVerification passed after one repair pass.`);
  }

  async function stageSelfReview(run) {
    const result = await runCodexExec(run, 'parent', run.worktrees.parent.path, generateSelfReviewPrompt(run), 'self review');
    writeTextArtifact(run, 'codex/self-review-stage.txt', result.plain || '', { name: 'Self Review Output' });
    appendJournal(run, `## Self Review\nSelf-review completed at ${nowIso()}.`);
  }

  async function stageBrowserValidation(run) {
    const scenarios = Array.isArray(run.task.browserScenarios) ? run.task.browserScenarios : [];
    if (!scenarios.length) {
      stageSkip(run, 'browser_validation', 'No browser scenarios configured');
      return 'skipped';
    }

    const browserInfo = detectPlaywright();
    if (!browserInfo.ready) throw new Error('Playwright or Chromium is not available on the Pi');

    const browserDir = path.join(artifactBaseDir(run), 'browser');
    ensureDir(browserDir, 0o700);

    const log = (line) => appendChannel(run, 'browser-worker', String(line || '') + '\n');
    run.browser.attempts += 1;
    let result = await runBrowserValidation({ scenarios, artifactDir: browserDir, log, nowIso });
    run.browser.lastResult = result;
    writeJsonArtifact(run, 'browser/attempt-1.json', result, { name: 'Browser Validation Attempt 1' });
    for (const file of (result.screenshots || []).map((f) => path.join(browserDir, f))) {
      if (fs.existsSync(file)) registerExistingArtifact(run, file, { name: path.basename(file), type: 'image' });
    }

    if (!result.ok) {
      appendChannel(run, 'orchestrator', '[browser] validation failed; running one repair pass\n');
      await runCodexExec(run, 'parent', run.worktrees.parent.path, generateRepairPrompt(run, 'browser validation failed'), 'browser repair');
      run.browser.attempts += 1;
      result = await runBrowserValidation({ scenarios, artifactDir: browserDir, log, nowIso });
      run.browser.lastResult = result;
      writeJsonArtifact(run, 'browser/attempt-2.json', result, { name: 'Browser Validation Attempt 2' });
      for (const file of (result.screenshots || []).map((f) => path.join(browserDir, f))) {
        if (fs.existsSync(file) && !run.artifacts.some((a) => a.relPath === path.relative(artifactBaseDir(run), file).replace(/\\/g, '/'))) {
          registerExistingArtifact(run, file, { name: path.basename(file), type: 'image' });
        }
      }
      if (!result.ok) throw new Error('browser validation failed after repair pass');
    }

    appendJournal(run, `## Browser Validation\nBrowser validation passed with ${scenarios.length} scenarios.`);
  }

  async function stageFinalizeCommitPush(run) {
    const cwd = run.worktrees.parent?.path;
    if (!cwd) throw new Error('parent worktree missing');

    const commitTitle = `Harness: ${run.task.title}`.slice(0, 72);
    const commitBody = [
      '',
      `Harness Run: ${run.id}`,
      `Objective: ${run.task.objective}`,
      `Generated by Harness Engineering workflow`,
      ''
    ].join('\n');
    writeTextArtifact(run, 'git/commit-message.txt', `${commitTitle}\n${commitBody}`, { name: 'Commit Message' });

    await runShellInParent(run, 'git add -A', 'git add');
    const status = spawnSyncText('git', ['-C', cwd, 'status', '--porcelain']);
    const statusLines = String(status.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    writeTextArtifact(run, 'git/status-before-commit.txt', String(status.stdout || '') + String(status.stderr || ''), {
      name: 'Git Status Before Commit'
    });

    if (!statusLines.length) {
      run.pushResult = { ok: true, skipped: true, reason: 'no changes to commit' };
      appendChannel(run, 'orchestrator', '[git] no changes to commit; finalize stage skipped commit/push\n');
      appendJournal(run, '## Finalize\nNo changes detected; commit/push skipped.');
      return;
    }

    const commitCmd = `git commit -m ${shellEscapeSingle(commitTitle)} -m ${shellEscapeSingle(`Harness Run: ${run.id}\nObjective: ${run.task.objective}`)}`;
    const commitOut = await runShellInParent(run, commitCmd, 'git commit', true);
    writeTextArtifact(run, 'git/commit-output.txt', commitOut.plain || '', { name: 'Git Commit Output' });
    if ((commitOut.code || 0) !== 0) throw new Error('git commit failed');

    const rev = spawnSyncText('git', ['-C', cwd, 'rev-parse', 'HEAD']);
    run.finalCommit = String(rev.stdout || '').trim();
    persistRun(run);

    const pushCmd = `git push -u origin ${shellEscapeSingle(run.finalBranch)}`;
    const pushOut = await runShellInParent(run, pushCmd, 'git push', true);
    writeTextArtifact(run, 'git/push-output.txt', pushOut.plain || '', { name: 'Git Push Output' });
    run.pushResult = {
      ok: (pushOut.code || 0) === 0,
      code: pushOut.code,
      branch: run.finalBranch,
      remote: 'origin',
      outputTail: String(pushOut.plain || '').slice(-4000)
    };
    persistRun(run);
    if (!run.pushResult.ok) throw new Error('git push failed');
    appendJournal(run, `## Finalize\nCommitted ${run.finalCommit} and pushed ${run.finalBranch} to origin.`);
  }

  async function runPipeline(run) {
    run.status = 'running';
    run.startedAt = nowIso();
    run.updatedAt = nowIso();
    broadcastRunState(run);
    persistRun(run);

    const stageFns = {
      init: stageInit,
      worktree_prepare: stageWorktreePrepare,
      artifact_scaffold: stageArtifactScaffold,
      parent_plan: stageParentPlan,
      subtask_fanout: stageSubtaskFanout,
      subtask_collect: stageSubtaskCollect,
      parent_integrate: stageParentIntegrate,
      test_verify: stageTestVerify,
      self_review: stageSelfReview,
      browser_validation: stageBrowserValidation,
      finalize_commit_push: stageFinalizeCommitPush
    };

    appendChannel(run, 'orchestrator', `[harness] run started at ${run.startedAt}\n`);

    try {
      for (const key of STAGES) {
        ensureNoCancel(run);
        markStage(run, key, 'running', 'running');
        appendChannel(run, 'orchestrator', `[stage] ${key}: started\n`);
        try {
          const outcome = await stageFns[key](run);
          const stage = run.stages.find((s) => s.key === key);
          if (stage && stage.status === 'skipped') {
            appendChannel(run, 'orchestrator', `[stage] ${key}: skipped (${stage.detail || ''})\n`);
          } else {
            markStage(run, key, 'completed', outcome === 'skipped' ? 'skipped' : 'completed');
            appendChannel(run, 'orchestrator', `[stage] ${key}: completed\n`);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          markStage(run, key, 'failed', msg);
          throw e;
        }
      }

      run.status = 'completed';
      run.finishedAt = nowIso();
      run.updatedAt = nowIso();
      await finalizeRunSummary(run);
      appendChannel(run, 'orchestrator', '[harness] run completed successfully\n');
      broadcastRunState(run);
      persistRun(run);
    } catch (e) {
      const cancelled = e && e.code === 'CANCELLED';
      run.status = cancelled ? 'cancelled' : 'failed';
      run.error = e instanceof Error ? e.message : String(e);
      run.finishedAt = nowIso();
      run.updatedAt = nowIso();
      appendChannel(run, 'orchestrator', `[harness] run ${run.status}: ${run.error}\n`);
      try {
        await finalizeRunSummary(run);
      } catch {
        // ignore summary generation failure on error path
      }
      broadcastRunState(run);
      persistRun(run);
    } finally {
      killActiveJobs(run);
    }
  }

  async function createAndStartRun(task) {
    const run = createRun(task);
    void runPipeline(run);
    return run;
  }

  function stopRun(run) {
    run.cancelRequested = true;
    run.updatedAt = nowIso();
    appendChannel(run, 'orchestrator', '[harness] cancel requested\n');
    killActiveJobs(run);
    broadcastRunState(run);
    persistRun(run);
  }

  function artifactFileFor(run, artifactId) {
    const artifact = run.artifacts.find((a) => a.id === artifactId);
    if (!artifact) return null;
    const file = path.join(artifactBaseDir(run), artifact.relPath);
    if (!pathInside(file, artifactBaseDir(run))) return null;
    return { artifact, file };
  }

  async function narrateRunSummary(run, body) {
    const personaChoice = choosePersona(body?.mode, body?.personaId);
    const persona = personaChoice.persona || run.persona || personas[0] || { name: 'Narrator', voiceId: '', personality: '' };
    const summaryText = String(run.summaryText || summarizeRunDeterministic(run)).trim();
    if (!summaryText) throw new Error('no run summary available');

    const env = readEnvMap();
    const inworldApiKey = String(env.INWORLD_API_KEY || '').trim();
    const inworldSecret = String(env.INWORLD_SECRET || '').trim();
    const audioPlaylist = [];

    if (inworldApiKey && inworldSecret && persona.voiceId && typeof generateInworldAudio === 'function') {
      try {
        const audio = await generateInworldAudio(
          inworldApiKey,
          inworldSecret,
          persona.voiceId,
          summaryText,
          `harness-${run.id}`
        );
        if (audio && audio.url) {
          audioPlaylist.push({
            title: `Harness Summary (${persona.name})`,
            url: String(audio.url),
            type: 'audio/mpeg',
            voice: persona.voiceId
          });
        }
      } catch {
        // summary still returned without audio
      }
    }

    return {
      ok: true,
      runId: run.id,
      generatedAt: nowIso(),
      summaryText,
      persona: { id: persona.id || slugify(persona.name || 'persona'), name: persona.name || 'Persona', voiceId: persona.voiceId || '' },
      audioPlaylist
    };
  }

  async function handleHttp(req, res, url) {
    const pathname = String(url?.pathname || '');
    if (!pathname.startsWith('/api/harness')) return false;

    try {
      if (pathname === '/api/harness/config' && req.method === 'GET') {
        sendJson(res, 200, harnessConfig());
        return true;
      }

      if (pathname === '/api/harness/personas' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, personas: personas.map((p) => ({ id: p.id, name: p.name, voiceId: p.voiceId || '' })) });
        return true;
      }

      if (pathname === '/api/harness/runs' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, runs: listRunSnapshots() });
        return true;
      }

      if (pathname === '/api/harness/runs' && req.method === 'POST') {
        if (!pty) {
          jsonError(res, 503, 'node-pty dependency is not installed');
          return true;
        }
        const body = await readJsonBody(req);
        const task = normalizeTaskInput(body);
        const run = await createAndStartRun(task);
        sendJson(res, 202, { ok: true, run: runSnapshot(run) });
        return true;
      }

      const m = pathname.match(/^\/api\/harness\/runs\/([^/]+)(?:\/(.*))?$/);
      if (!m) {
        jsonError(res, 404, 'not found');
        return true;
      }

      const runId = decodeURIComponent(m[1] || '');
      const tail = String(m[2] || '').replace(/\/+$/, '');
      const run = runs.get(runId);

      if (!tail && req.method === 'GET') {
        if (run) {
          sendJson(res, 200, { ok: true, run: runSnapshot(run) });
          return true;
        }
        const file = path.join(HARNESS_RUNS_DIR, `${runId}.json`);
        if (!fs.existsSync(file)) {
          jsonError(res, 404, 'run not found');
          return true;
        }
        const parsed = safeJsonParse(fs.readFileSync(file, 'utf8'));
        if (!parsed.ok) {
          jsonError(res, 500, 'failed to read run snapshot');
          return true;
        }
        sendJson(res, 200, { ok: true, run: parsed.value });
        return true;
      }

      if (!run) {
        jsonError(res, 404, 'run not found');
        return true;
      }

      if (tail === 'stop' && req.method === 'POST') {
        stopRun(run);
        sendJson(res, 200, { ok: true, run: runSnapshot(run) });
        return true;
      }

      if (tail === 'terminals' && req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          runId,
          terminals: TERMINAL_CHANNELS.map((name) => channelSummary(run, name))
        });
        return true;
      }

      if (tail === 'artifacts' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, runId, artifacts: run.artifacts.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))) });
        return true;
      }

      const aMatch = tail.match(/^artifacts\/([^/]+)$/);
      if (aMatch && req.method === 'GET') {
        const artifactId = decodeURIComponent(aMatch[1] || '');
        const hit = artifactFileFor(run, artifactId);
        if (!hit) {
          jsonError(res, 404, 'artifact not found');
          return true;
        }
        const { artifact, file } = hit;
        const wantsRaw = String(url.searchParams.get('raw') || '').trim() === '1';
        if (wantsRaw || String(artifact.mime || '').startsWith('image/')) {
          if (!fs.existsSync(file)) {
            jsonError(res, 404, 'artifact file missing');
            return true;
          }
          const stat = fs.statSync(file);
          res.writeHead(200, {
            'Content-Type': artifact.mime || guessMime(file),
            'Cache-Control': 'no-store',
            'Content-Length': stat.size
          });
          fs.createReadStream(file).pipe(res);
          return true;
        }

        let content = '';
        try {
          content = fs.readFileSync(file, 'utf8');
        } catch {
          jsonError(res, 500, 'failed to read artifact');
          return true;
        }
        sendJson(res, 200, { ok: true, artifact, content });
        return true;
      }

      if (tail === 'narrate-summary' && req.method === 'POST') {
        const body = await readJsonBody(req);
        try {
          const payload = await narrateRunSummary(run, body);
          sendJson(res, 200, payload);
        } catch (e) {
          jsonError(res, 400, e instanceof Error ? e.message : String(e));
        }
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

  function attachSocket(ws, run, channelName) {
    const ch = run.channels[channelName];
    if (!ch) {
      sendSocket(ws, { type: 'error', message: 'unknown channel' });
      try { ws.close(); } catch {}
      return;
    }

    ch.sockets.add(ws);
    sendSocket(ws, { type: 'hello', runId: run.id, channel: channelName, run: runSnapshot(run) });
    const snap = ch.ring.dump();
    if (snap) sendSocket(ws, { type: 'snapshot', runId: run.id, channel: channelName, data: snap });

    ws.on('message', (buf) => {
      let msg = null;
      try { msg = JSON.parse(String(buf || '')); } catch { msg = null; }
      if (!msg || typeof msg !== 'object') return;
      const t = String(msg.type || '');
      if (t === 'ping') {
        sendSocket(ws, { type: 'pong', ts: Number(msg.ts || Date.now()) });
        return;
      }
      if (t === 'resize') {
        ch.cols = clampInt(msg.cols, 20, 400, ch.cols || 120);
        ch.rows = clampInt(msg.rows, 5, 200, ch.rows || 34);
      }
    });

    ws.on('close', () => {
      ch.sockets.delete(ws);
      persistRun(run);
    });
    ws.on('error', () => {
      ch.sockets.delete(ws);
    });
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
    if (url.pathname !== '/api/harness/ws') return false;

    const runId = String(url.searchParams.get('runId') || '').trim();
    const channel = String(url.searchParams.get('channel') || 'orchestrator').trim();
    const run = runs.get(runId);
    if (!run) {
      sendUpgradeHttpError(socket, 404, 'Not Found');
      return true;
    }
    if (!run.channels[channel]) {
      sendUpgradeHttpError(socket, 404, 'Not Found');
      return true;
    }

    wss.handleUpgrade(req, socket, head, (ws) => attachSocket(ws, run, channel));
    return true;
  }

  return {
    handleHttp,
    handleUpgrade,
    getConfig: harnessConfig
  };
}

module.exports = {
  createHarnessFeature
};
