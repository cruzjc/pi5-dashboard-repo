import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from 'xterm';

type HarnessPersona = {
  id: string;
  name: string;
  voiceId?: string;
};

type HarnessConfig = {
  ok?: boolean;
  now?: string;
  limits?: {
    maxSubtasks?: number;
    channels?: string[];
    stages?: string[];
  };
  paths?: {
    homeDir?: string;
    sharedReposDir?: string;
    harnessWorkspaceDir?: string;
    harnessDataDir?: string;
  };
  dependencies?: {
    ws?: boolean;
    nodePty?: boolean;
    codex?: boolean;
    playwright?: boolean;
    chromium?: boolean;
  };
  codex?: {
    version?: string | null;
    authStatus?: {
      status?: string;
      detail?: string;
    };
  };
  browser?: {
    installed?: boolean;
    chromiumPath?: string | null;
    chromiumVersion?: string | null;
    ready?: boolean;
  };
  personas?: HarnessPersona[];
};

type HarnessTerminalSummary = {
  name: string;
  running?: boolean;
  pid?: number | null;
  startedAt?: string | null;
  exitedAt?: string | null;
  exitCode?: number | null;
  exitSignal?: string | null;
  lastError?: string | null;
  clients?: number;
};

type HarnessStage = {
  key: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | string;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  detail?: string;
};

type HarnessArtifact = {
  id: string;
  name: string;
  relPath: string;
  type?: string;
  mime?: string;
  size?: number | null;
  createdAt?: string;
  description?: string;
};

type HarnessRun = {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  status?: string;
  currentStage?: string | null;
  cancelRequested?: boolean;
  error?: string | null;
  task?: {
    title?: string;
    repoPath?: string;
    objective?: string;
    successCriteria?: string;
    constraints?: string;
    subtaskCount?: number;
    verificationCommands?: string[];
    browserScenarios?: Array<Record<string, unknown>>;
    personaMode?: string;
    personaId?: string;
  };
  persona?: { id?: string; name?: string; voiceId?: string } | null;
  repo?: {
    inputPath?: string;
    rootPath?: string;
    baseBranch?: string;
    remote?: string;
  };
  worktrees?: {
    baseRoot?: string;
    parent?: { path?: string; branch?: string } | null;
    subtasks?: Array<{ path?: string; branch?: string }>;
  };
  stages?: HarnessStage[];
  terminals?: HarnessTerminalSummary[];
  artifacts?: HarnessArtifact[];
  summaryText?: string;
  finalBranch?: string;
  finalCommit?: string;
  pushResult?: unknown;
  subtaskResults?: unknown[];
  browser?: {
    scenarios?: unknown[];
    attempts?: number;
    lastResult?: unknown;
  };
};

type HarnessRunListEnvelope = { ok?: boolean; runs?: HarnessRun[]; error?: string };
type HarnessRunEnvelope = { ok?: boolean; run?: HarnessRun; error?: string };

type NarrationResponse = {
  ok?: boolean;
  runId?: string;
  generatedAt?: string;
  summaryText?: string;
  persona?: { id?: string; name?: string; voiceId?: string };
  audioPlaylist?: Array<{ title?: string; url?: string; type?: string; voice?: string }>;
  error?: string;
};

type ArtifactTextEnvelope = {
  ok?: boolean;
  artifact?: HarnessArtifact;
  content?: string;
  error?: string;
};

type AiCliProviderInfo = {
  id: string;
  title?: string;
  workspace?: string;
  sharedReposDir?: string;
  version?: string | null;
  authStatus?: { status?: string; detail?: string; checkedAt?: string | null };
  authJob?: { running?: boolean; pid?: number | null };
  capabilities?: { authStatus?: boolean; authLogout?: boolean };
};

type AiCliProviderEnvelope = { ok?: boolean; provider?: AiCliProviderInfo; error?: string };

type AuthHint = { url?: string; code?: string; text?: string };

type HarnessWsMessage =
  | { type?: 'hello'; run?: HarnessRun; channel?: string }
  | { type?: 'snapshot' | 'output'; data?: string; channel?: string }
  | { type?: 'run_state'; run?: HarnessRun }
  | { type?: 'error'; message?: string };

type AiCliWsMessage =
  | { type?: 'hello' | 'snapshot' | 'output'; data?: string }
  | { type?: 'state'; state?: { authJob?: { running?: boolean } } }
  | { type?: 'auth_hint'; url?: string; code?: string; text?: string }
  | { type?: 'error'; message?: string };

function fmtDateTime(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

function fmtBytes(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return '—';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDurationMs(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return '—';
  if (v < 1000) return `${Math.round(v)} ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)} s`;
  return `${(v / 60_000).toFixed(1)} min`;
}

function wsBaseUrl(pathname: string): URL {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return new URL(`${proto}//${window.location.host}${pathname}`);
}

function trimTail(text: string, maxChars: number): string {
  const s = String(text || '');
  return s.length <= maxChars ? s : s.slice(s.length - maxChars);
}

@Component({
  selector: 'app-harness-engineering',
  imports: [FormsModule],
  templateUrl: './harness-engineering.component.html',
  styleUrl: './harness-engineering.component.scss'
})
export class HarnessEngineeringComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('termHost') private readonly termHost?: ElementRef<HTMLDivElement>;

  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly toast = signal('');
  protected readonly createBusy = signal(false);
  protected readonly actionBusy = signal(false);

  protected readonly config = signal<HarnessConfig | null>(null);
  protected readonly personas = signal<HarnessPersona[]>([]);
  protected readonly runs = signal<HarnessRun[]>([]);
  protected readonly selectedRunId = signal('');
  protected readonly selectedRun = signal<HarnessRun | null>(null);

  protected readonly title = signal('Harness Task');
  protected readonly repoPath = signal('');
  protected readonly objective = signal('');
  protected readonly successCriteria = signal('');
  protected readonly constraints = signal('');
  protected readonly baseBranch = signal('');
  protected readonly subtaskCount = signal(1);
  protected readonly verificationCommandsText = signal('');
  protected readonly browserScenarioUrls = signal('');
  protected readonly subtaskPromptsText = signal('');
  protected readonly personaMode = signal<'selected' | 'random'>('selected');
  protected readonly personaId = signal('');

  protected readonly authProvider = signal<AiCliProviderInfo | null>(null);
  protected readonly authLog = signal('');
  protected readonly authHints = signal<AuthHint[]>([]);
  protected readonly authBusy = signal(false);
  protected readonly authConnected = signal(false);

  protected readonly terminalChannel = signal('orchestrator');
  protected readonly terminalConnected = signal(false);
  protected readonly terminalError = signal('');

  protected readonly selectedArtifactId = signal('');
  protected readonly artifactPreviewBusy = signal(false);
  protected readonly artifactPreviewError = signal('');
  protected readonly artifactPreviewText = signal('');
  protected readonly artifactPreviewImageUrl = signal('');
  protected readonly artifactPreviewMime = signal('');

  protected readonly narrationBusy = signal(false);
  protected readonly narrationError = signal('');
  protected readonly narrationSummary = signal('');
  protected readonly narrationPersona = signal('');
  protected readonly narrationAudioUrl = signal('');
  protected readonly narrationGeneratedAt = signal('');

  protected readonly maxSubtasks = computed(() => {
    const raw = this.config()?.limits?.maxSubtasks;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 3;
  });

  protected readonly harnessWorkspacePath = computed(
    () => this.config()?.paths?.harnessWorkspaceDir || this.authProvider()?.workspace || '—'
  );
  protected readonly sharedReposPath = computed(
    () => this.config()?.paths?.sharedReposDir || this.authProvider()?.sharedReposDir || '—'
  );
  protected readonly codexVersion = computed(
    () => this.config()?.codex?.version || this.authProvider()?.version || '—'
  );
  protected readonly browserReady = computed(() => this.config()?.browser?.ready === true);

  protected readonly selectedRunStatus = computed(() => this.selectedRun()?.status || '—');
  protected readonly selectedRunStage = computed(() => this.selectedRun()?.currentStage || '—');
  protected readonly selectedRunBranch = computed(
    () => this.selectedRun()?.finalBranch || this.selectedRun()?.worktrees?.parent?.branch || '—'
  );

  protected readonly channels = computed(() => {
    const terms = this.selectedRun()?.terminals || [];
    const names = terms.map((t) => String(t.name || '')).filter(Boolean);
    return names.length ? names : ['orchestrator'];
  });

  protected readonly selectedChannelSummary = computed(() => {
    const name = this.terminalChannel();
    return this.selectedRun()?.terminals?.find((t) => t.name === name) || null;
  });

  protected readonly artifactsSorted = computed(() => {
    const list = Array.isArray(this.selectedRun()?.artifacts) ? [...(this.selectedRun()?.artifacts as HarnessArtifact[])] : [];
    list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return list;
  });

  protected readonly selectedArtifact = computed(() => {
    const id = this.selectedArtifactId();
    if (!id) return null;
    return this.artifactsSorted().find((a) => a.id === id) || null;
  });

  protected readonly canStartRun = computed(() => {
    if (this.createBusy()) return false;
    return Boolean(this.title().trim() && this.repoPath().trim() && this.objective().trim());
  });

  protected readonly runIsActive = computed(() => {
    const s = String(this.selectedRun()?.status || '');
    return s === 'created' || s === 'running';
  });

  protected readonly authStatusLabel = computed(() => {
    const raw = String(this.authProvider()?.authStatus?.status || this.config()?.codex?.authStatus?.status || 'unknown').toLowerCase();
    if (raw === 'logged_in') return 'Logged In';
    if (raw === 'logged_out') return 'Logged Out';
    if (raw === 'error') return 'Error';
    return 'Unknown';
  });

  protected readonly authStatusClass = computed(() => {
    const raw = String(this.authProvider()?.authStatus?.status || this.config()?.codex?.authStatus?.status || 'unknown').toLowerCase();
    if (raw === 'logged_in') return 'good';
    if (raw === 'logged_out') return 'warn';
    if (raw === 'error') return 'bad';
    return 'muted';
  });

  protected readonly authJobRunning = computed(() => this.authProvider()?.authJob?.running === true);

  protected readonly formattedRunStartedAt = computed(() => fmtDateTime(this.selectedRun()?.startedAt || null));
  protected readonly formattedRunFinishedAt = computed(() => fmtDateTime(this.selectedRun()?.finishedAt || null));
  protected readonly formattedNarrationAt = computed(() => fmtDateTime(this.narrationGeneratedAt() || null));

  private term: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private pendingTermChunks: string[] = [];

  private runWs: WebSocket | null = null;
  private runWsRunId = '';
  private runWsChannel = '';
  private authWs: WebSocket | null = null;

  private pollTimer: number | null = null;
  private activePollTimer: number | null = null;
  private toastTimer: number | null = null;
  private reconnectTimer: number | null = null;

  ngOnInit(): void {
    void this.loadInitial();
    this.startPolling();
  }

  ngAfterViewInit(): void {
    this.initTerminal();
    this.flushPendingTerminalData();
  }

  ngOnDestroy(): void {
    this.clearTimers();
    this.closeRunSocket();
    this.closeAuthSocket();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.term?.dispose();
    this.term = null;
  }

  protected onTextInput(sig: ReturnType<typeof signal<string>>, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    sig.set(target.value || '');
  }

  protected onSubtaskCountChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const max = this.maxSubtasks();
    const parsed = Number.parseInt(target.value || '0', 10);
    const clamped = Number.isFinite(parsed) ? Math.min(max, Math.max(0, parsed)) : 0;
    this.subtaskCount.set(clamped);
  }

  protected onPersonaModeChange(mode: 'selected' | 'random'): void {
    this.personaMode.set(mode);
  }

  protected onPersonaSelect(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    this.personaId.set(target.value || '');
    this.personaMode.set('selected');
  }

  protected async startRun(): Promise<void> {
    this.error.set('');
    this.createBusy.set(true);
    try {
      const body = {
        title: this.title().trim(),
        repoPath: this.repoPath().trim(),
        objective: this.objective().trim(),
        successCriteria: this.successCriteria().trim(),
        constraints: this.constraints().trim(),
        baseBranch: this.baseBranch().trim(),
        subtaskCount: this.subtaskCount(),
        verificationCommandsText: this.verificationCommandsText(),
        browserScenarioUrls: this.browserScenarioUrls(),
        subtaskPromptsText: this.subtaskPromptsText(),
        personaMode: this.personaMode(),
        personaId: this.personaMode() === 'selected' ? this.personaId() : undefined
      };
      const data = await this.postJson<HarnessRunEnvelope>('/api/harness/runs', body);
      const run = data?.run || null;
      if (!run?.id) throw new Error(data?.error || 'Failed to start harness run');
      this.pushToast(`Started harness run ${run.id}`);
      await this.refreshConfig(false);
      await this.refreshRuns(false);
      await this.selectRunById(run.id, true);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.createBusy.set(false);
    }
  }

  protected async stopSelectedRun(): Promise<void> {
    const runId = this.selectedRunId();
    if (!runId) return;
    this.actionBusy.set(true);
    this.error.set('');
    try {
      const data = await this.postJson<HarnessRunEnvelope>(`/api/harness/runs/${encodeURIComponent(runId)}/stop`, {});
      if (data?.run) this.applyRunUpdate(data.run);
      this.pushToast('Stop requested');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.actionBusy.set(false);
    }
  }

  protected async refreshAll(): Promise<void> {
    this.error.set('');
    try {
      await Promise.all([this.refreshConfig(false), this.refreshRuns(false), this.refreshAuthProvider(false)]);
      if (this.selectedRunId()) await this.refreshSelectedRun(false);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected async selectRun(run: HarnessRun): Promise<void> {
    if (!run?.id) return;
    await this.selectRunById(run.id, true);
  }

  protected async chooseChannel(name: string): Promise<void> {
    if (!name) return;
    this.terminalChannel.set(name);
    this.clearTerminalView();
    this.ensureRunSocket();
  }

  protected clearTerminalView(): void {
    this.term?.clear();
  }

  protected async selectArtifact(artifact: HarnessArtifact): Promise<void> {
    if (!artifact?.id || !this.selectedRunId()) return;
    this.selectedArtifactId.set(artifact.id);
    this.artifactPreviewError.set('');
    this.artifactPreviewText.set('');
    this.artifactPreviewImageUrl.set('');
    this.artifactPreviewMime.set(String(artifact.mime || ''));

    if (String(artifact.mime || '').startsWith('image/')) {
      this.artifactPreviewImageUrl.set(this.artifactEndpointUrl(artifact, true));
      return;
    }

    this.artifactPreviewBusy.set(true);
    try {
      const data = await this.getJson<ArtifactTextEnvelope>(this.artifactEndpointUrl(artifact));
      this.artifactPreviewText.set(String(data?.content || ''));
      this.artifactPreviewMime.set(String(data?.artifact?.mime || artifact.mime || ''));
    } catch (e) {
      this.artifactPreviewError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.artifactPreviewBusy.set(false);
    }
  }

  protected async narrateSummary(): Promise<void> {
    const runId = this.selectedRunId();
    if (!runId) return;
    this.narrationBusy.set(true);
    this.narrationError.set('');
    try {
      const payload = {
        mode: this.personaMode(),
        personaId: this.personaMode() === 'selected' ? this.personaId() : undefined
      };
      const data = await this.postJson<NarrationResponse>(`/api/harness/runs/${encodeURIComponent(runId)}/narrate-summary`, payload);
      if (!data || data.ok !== true) throw new Error(data?.error || 'Narration failed');
      this.narrationSummary.set(String(data.summaryText || '').trim());
      this.narrationPersona.set(String(data.persona?.name || ''));
      this.narrationGeneratedAt.set(String(data.generatedAt || ''));
      const firstAudio = Array.isArray(data.audioPlaylist) ? data.audioPlaylist[0] : null;
      this.narrationAudioUrl.set(firstAudio?.url ? String(firstAudio.url) : '');
      if (!firstAudio?.url) {
        this.pushToast('Summary generated (no audio file).');
      }
    } catch (e) {
      this.narrationError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.narrationBusy.set(false);
    }
  }

  protected async refreshAuthStatus(): Promise<void> {
    this.authBusy.set(true);
    this.error.set('');
    try {
      const data = await this.postJson<{ ok?: boolean; providerState?: AiCliProviderInfo; error?: string }>(
        '/api/ai-cli/session/codex-harness/auth/status',
        {}
      );
      if (data?.providerState) this.authProvider.set(data.providerState);
      await this.refreshConfig(false);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.authBusy.set(false);
    }
  }

  protected async loginCodex(): Promise<void> {
    this.authBusy.set(true);
    this.error.set('');
    this.authLog.set('');
    this.authHints.set([]);
    try {
      await this.postJson('/api/ai-cli/session/codex-harness/auth/login', {});
      await this.refreshAuthProvider(false);
      this.ensureAuthSocket();
      this.pushToast('Codex auth flow started');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.authBusy.set(false);
    }
  }

  protected async stopAuthJob(): Promise<void> {
    this.authBusy.set(true);
    this.error.set('');
    try {
      await this.postJson('/api/ai-cli/session/codex-harness/auth/stop', {});
      await this.refreshAuthProvider(false);
      if (!this.authJobRunning()) this.closeAuthSocket();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.authBusy.set(false);
    }
  }

  protected async logoutCodex(): Promise<void> {
    this.authBusy.set(true);
    this.error.set('');
    try {
      await this.postJson('/api/ai-cli/session/codex-harness/auth/logout', {});
      await this.refreshAuthProvider(false);
      await this.refreshConfig(false);
      this.pushToast('Codex logout command completed');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.authBusy.set(false);
    }
  }

  protected trackRun(_index: number, run: HarnessRun): string {
    return run.id;
  }

  protected trackStage(_index: number, stage: HarnessStage): string {
    return stage.key;
  }

  protected trackArtifact(_index: number, artifact: HarnessArtifact): string {
    return artifact.id;
  }

  protected stageClass(stage: HarnessStage): string {
    const s = String(stage?.status || 'pending');
    if (s === 'completed') return 'done';
    if (s === 'running') return 'running';
    if (s === 'failed') return 'failed';
    if (s === 'skipped') return 'skipped';
    return 'pending';
  }

  protected terminalTabClass(name: string): string {
    return this.terminalChannel() === name ? 'active' : '';
  }

  protected isRunSelected(run: HarnessRun): boolean {
    return this.selectedRunId() === run.id;
  }

  protected terminalOverlayText(): string {
    if (!this.selectedRun()) return 'Select a run to stream logs';
    if (this.terminalConnected()) return '';
    if (this.runIsActive()) return 'Connecting stream...';
    return 'No live stream (historical run or stage idle)';
  }

  protected statusBadgeClass(status: string | null | undefined): string {
    const s = String(status || '').toLowerCase();
    if (s === 'completed') return 'good';
    if (s === 'running' || s === 'created') return 'info';
    if (s === 'failed' || s === 'cancelled') return 'bad';
    if (s === 'skipped') return 'warn';
    return 'muted';
  }

  protected authHintLabel(h: AuthHint): string {
    if (h.code) return `Code: ${h.code}`;
    if (h.url) return h.url;
    return h.text || 'Auth hint';
  }

  protected authHintUrl(h: AuthHint): string {
    return h.url || '';
  }

  protected formatDate(raw: string | null | undefined): string {
    return fmtDateTime(raw);
  }

  protected formatBytes(v: number | null | undefined): string {
    return fmtBytes(v);
  }

  protected formatDuration(v: number | null | undefined): string {
    return fmtDurationMs(v);
  }

  protected artifactEndpointUrl(artifact: HarnessArtifact, raw = false): string {
    const runId = this.selectedRunId();
    const url = new URL(`/api/harness/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact.id)}`, window.location.origin);
    if (raw) url.searchParams.set('raw', '1');
    url.searchParams.set('t', String(Date.now()));
    return url.pathname + url.search;
  }

  protected async copyText(text: string, message: string): Promise<void> {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('Clipboard API unavailable');
      }
      this.pushToast(message);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected copySharedRepos(): void {
    void this.copyText(this.sharedReposPath(), 'Shared repos path copied');
  }

  protected copyHarnessWorkspace(): void {
    void this.copyText(this.harnessWorkspacePath(), 'Harness workspace path copied');
  }

  protected refreshSelectedRunAction(): void {
    void this.refreshSelectedRun(false);
  }

  protected selectedArtifactRawUrl(): string {
    const artifact = this.selectedArtifact();
    return artifact ? this.artifactEndpointUrl(artifact, true) : '';
  }

  protected pushResultJson(): string {
    const value = this.selectedRun()?.pushResult;
    if (value == null) return '';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private async loadInitial(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      await Promise.all([this.refreshConfig(false), this.refreshRuns(false), this.refreshAuthProvider(false)]);
      if (!this.repoPath().trim()) {
        const shared = this.config()?.paths?.sharedReposDir || '';
        if (shared) this.repoPath.set(shared);
      }
      if (this.personas().length && !this.personaId()) {
        this.personaId.set(this.personas()[0].id);
      }
      const first = this.runs()[0];
      if (first?.id) {
        await this.selectRunById(first.id, false);
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }

  private startPolling(): void {
    this.clearPollingTimers();
    this.pollTimer = window.setInterval(() => {
      void this.refreshRuns(false);
      void this.refreshConfig(false);
      void this.refreshAuthProvider(false);
    }, 15000);

    this.activePollTimer = window.setInterval(() => {
      if (this.selectedRunId()) {
        const run = this.selectedRun();
        const active = run ? ['created', 'running'].includes(String(run.status || '')) : false;
        if (active) void this.refreshSelectedRun(false);
      }
    }, 2500);
  }

  private clearTimers(): void {
    this.clearPollingTimers();
    if (this.toastTimer != null) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearPollingTimers(): void {
    if (this.pollTimer != null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.activePollTimer != null) {
      window.clearInterval(this.activePollTimer);
      this.activePollTimer = null;
    }
  }

  private pushToast(message: string): void {
    this.toast.set(message);
    if (this.toastTimer != null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.set(''), 3000);
  }

  private async refreshConfig(setLoading: boolean): Promise<void> {
    if (setLoading) this.loading.set(true);
    try {
      const data = await this.getJson<HarnessConfig>('/api/harness/config');
      this.config.set(data || null);
      const personas = Array.isArray(data?.personas) ? data.personas : [];
      this.personas.set(personas);
      if (!this.personaId() && personas.length) this.personaId.set(personas[0].id);
    } finally {
      if (setLoading) this.loading.set(false);
    }
  }

  private async refreshRuns(setLoading: boolean): Promise<void> {
    if (setLoading) this.loading.set(true);
    try {
      const data = await this.getJson<HarnessRunListEnvelope>('/api/harness/runs');
      const list = Array.isArray(data?.runs) ? data.runs : [];
      this.runs.set(list);
      if (this.selectedRunId()) {
        const next = list.find((r) => r.id === this.selectedRunId());
        if (next) this.selectedRun.set(next);
      }
    } finally {
      if (setLoading) this.loading.set(false);
    }
  }

  private async refreshSelectedRun(updateSockets = true): Promise<void> {
    const id = this.selectedRunId();
    if (!id) return;
    const data = await this.getJson<HarnessRunEnvelope>(`/api/harness/runs/${encodeURIComponent(id)}`);
    if (data?.run) {
      this.applyRunUpdate(data.run);
      if (updateSockets) this.ensureRunSocket();
    }
  }

  private async selectRunById(runId: string, connectSockets: boolean): Promise<void> {
    this.selectedRunId.set(runId);
    this.selectedArtifactId.set('');
    this.artifactPreviewText.set('');
    this.artifactPreviewImageUrl.set('');
    this.artifactPreviewError.set('');
    this.narrationError.set('');
    this.narrationSummary.set('');
    this.narrationAudioUrl.set('');
    await this.refreshSelectedRun(connectSockets);
    const available = this.channels();
    if (!available.includes(this.terminalChannel())) {
      this.terminalChannel.set(available[0] || 'orchestrator');
    }
    this.clearTerminalView();
    if (connectSockets) this.ensureRunSocket();
  }

  private applyRunUpdate(run: HarnessRun): void {
    if (!run?.id) return;
    this.selectedRun.set(run);
    this.selectedRunId.set(run.id);
    const list = [...this.runs()];
    const idx = list.findIndex((r) => r.id === run.id);
    if (idx >= 0) list[idx] = run;
    else list.unshift(run);
    list.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    this.runs.set(list.slice(0, 100));

    const channelNames = (run.terminals || []).map((t) => t.name).filter(Boolean);
    if (channelNames.length && !channelNames.includes(this.terminalChannel())) {
      this.terminalChannel.set(channelNames[0]);
      this.clearTerminalView();
      this.ensureRunSocket();
    }
  }

  private async refreshAuthProvider(setLoading: boolean): Promise<void> {
    if (setLoading) this.loading.set(true);
    try {
      const data = await this.getJson<AiCliProviderEnvelope>('/api/ai-cli/session/codex-harness');
      this.authProvider.set(data?.provider || null);
      if (data?.provider?.authJob?.running) this.ensureAuthSocket();
    } finally {
      if (setLoading) this.loading.set(false);
    }
  }

  private initTerminal(): void {
    if (typeof window === 'undefined') return;
    if (!this.termHost?.nativeElement || this.term) return;

    const term = new Terminal({
      disableStdin: true,
      convertEol: false,
      cursorBlink: false,
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: 12.5,
      lineHeight: 1.2,
      theme: {
        background: '#060912',
        foreground: '#d9ebff',
        cursor: '#7ee6d7',
        selectionBackground: 'rgba(126, 230, 215, 0.18)',
        black: '#0a0f18',
        red: '#ff8292',
        green: '#9bf0b7',
        yellow: '#ffe38d',
        blue: '#8bc3ff',
        magenta: '#d19eff',
        cyan: '#8ef7ea',
        white: '#e5f2ff'
      }
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(this.termHost.nativeElement);
    this.term = term;
    this.fitAddon = fitAddon;

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.fitTerminal());
      this.resizeObserver.observe(this.termHost.nativeElement);
    }

    window.setTimeout(() => this.fitTerminal(), 25);
  }

  private fitTerminal(): void {
    if (!this.term || !this.fitAddon) return;
    try {
      this.fitAddon.fit();
      const ws = this.runWs;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: this.term.cols, rows: this.term.rows }));
      }
    } catch {
      // ignore fit errors
    }
  }

  private writeTerminal(data: string): void {
    const text = String(data || '');
    if (!text) return;
    if (!this.term) {
      this.pendingTermChunks.push(text);
      if (this.pendingTermChunks.length > 200) this.pendingTermChunks = this.pendingTermChunks.slice(-200);
      return;
    }
    this.term.write(text);
  }

  private flushPendingTerminalData(): void {
    if (!this.term || !this.pendingTermChunks.length) return;
    for (const chunk of this.pendingTermChunks) this.term.write(chunk);
    this.pendingTermChunks = [];
  }

  private ensureRunSocket(): void {
    if (typeof window === 'undefined') return;
    const runId = this.selectedRunId();
    const channel = this.terminalChannel();
    if (!runId || !channel) {
      this.closeRunSocket();
      return;
    }

    const sameTarget = this.runWs && this.runWsRunId === runId && this.runWsChannel === channel;
    if (sameTarget && this.runWs && (this.runWs.readyState === WebSocket.OPEN || this.runWs.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.closeRunSocket();
    this.runWsRunId = runId;
    this.runWsChannel = channel;
    this.terminalConnected.set(false);
    this.terminalError.set('');

    const url = wsBaseUrl('/api/harness/ws');
    url.searchParams.set('runId', runId);
    url.searchParams.set('channel', channel);
    const ws = new WebSocket(url.toString());
    this.runWs = ws;

    ws.onopen = () => {
      this.terminalConnected.set(true);
      this.terminalError.set('');
      this.fitTerminal();
    };

    ws.onmessage = (event) => {
      this.handleRunWsMessage(event.data);
    };

    ws.onerror = () => {
      this.terminalConnected.set(false);
    };

    ws.onclose = () => {
      this.terminalConnected.set(false);
      if (this.runWs === ws) this.runWs = null;
      if (!this.selectedRunId() || this.selectedRunId() !== runId || this.terminalChannel() !== channel) return;
      if (!this.runIsActive()) return;
      if (this.reconnectTimer != null) window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => this.ensureRunSocket(), 1000);
    };
  }

  private handleRunWsMessage(raw: unknown): void {
    let msg: HarnessWsMessage | null = null;
    try {
      msg = JSON.parse(String(raw || '')) as HarnessWsMessage;
    } catch {
      msg = null;
    }
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'hello': {
        if (msg.run) this.applyRunUpdate(msg.run);
        break;
      }
      case 'snapshot':
      case 'output': {
        this.writeTerminal(String(msg.data || ''));
        break;
      }
      case 'run_state': {
        if (msg.run) this.applyRunUpdate(msg.run);
        break;
      }
      case 'error': {
        this.terminalError.set(String(msg.message || 'Terminal stream error'));
        break;
      }
      default:
        break;
    }
  }

  private closeRunSocket(): void {
    if (this.runWs) {
      try {
        this.runWs.close();
      } catch {
        // ignore
      }
    }
    this.runWs = null;
    this.runWsRunId = '';
    this.runWsChannel = '';
    this.terminalConnected.set(false);
  }

  private ensureAuthSocket(): void {
    if (typeof window === 'undefined') return;
    if (this.authWs && (this.authWs.readyState === WebSocket.OPEN || this.authWs.readyState === WebSocket.CONNECTING)) return;

    const url = wsBaseUrl('/api/ai-cli/ws');
    url.searchParams.set('provider', 'codex-harness');
    url.searchParams.set('channel', 'auth');
    const ws = new WebSocket(url.toString());
    this.authWs = ws;

    ws.onopen = () => {
      this.authConnected.set(true);
      this.error.set('');
    };
    ws.onmessage = (event) => {
      this.handleAuthWsMessage(event.data);
    };
    ws.onerror = () => {
      this.authConnected.set(false);
    };
    ws.onclose = () => {
      this.authConnected.set(false);
      if (this.authWs === ws) this.authWs = null;
      if (this.authJobRunning()) {
        window.setTimeout(() => this.ensureAuthSocket(), 1000);
      }
    };
  }

  private handleAuthWsMessage(raw: unknown): void {
    let msg: AiCliWsMessage | null = null;
    try {
      msg = JSON.parse(String(raw || '')) as AiCliWsMessage;
    } catch {
      msg = null;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'snapshot' || msg.type === 'output') {
      this.authLog.set(trimTail(this.authLog() + String(msg.data || ''), 80000));
      return;
    }
    if (msg.type === 'auth_hint') {
      const hint: AuthHint = { url: msg.url, code: msg.code, text: msg.text };
      const next = [...this.authHints()];
      next.unshift(hint);
      this.authHints.set(next.slice(0, 10));
      return;
    }
    if (msg.type === 'state') {
      void this.refreshAuthProvider(false);
      return;
    }
    if (msg.type === 'error') {
      this.error.set(String(msg.message || 'Auth stream error'));
    }
  }

  private closeAuthSocket(): void {
    if (this.authWs) {
      try {
        this.authWs.close();
      } catch {
        // ignore
      }
    }
    this.authWs = null;
    this.authConnected.set(false);
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { cache: 'no-store' });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg = data && typeof data === 'object' && 'error' in data ? String((data as { error?: unknown }).error || '') : '';
      throw new Error(msg || `HTTP ${res.status}`);
    }
    return data as T;
  }

  private async postJson<T = unknown>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {})
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg = data && typeof data === 'object' && 'error' in data ? String((data as { error?: unknown }).error || '') : '';
      throw new Error(msg || `HTTP ${res.status}`);
    }
    return data as T;
  }
}
