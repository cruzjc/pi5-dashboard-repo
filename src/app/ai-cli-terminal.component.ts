import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from 'xterm';

type ProviderId = 'codex' | 'claude' | 'gemini';

type SessionSummary = {
  running?: boolean;
  stopping?: boolean;
  pid?: number | null;
  startedAt?: string | null;
  exitedAt?: string | null;
  exitCode?: number | null;
  exitSignal?: string | null;
  cols?: number;
  rows?: number;
  clients?: number;
  lastError?: string | null;
};

type AuthStatus = {
  status?: string;
  detail?: string;
  checkedAt?: string | null;
  method?: string;
};

type PersonaPref = {
  mode?: 'selected' | 'random' | string;
  personaId?: string;
};

type ProviderInfo = {
  id: ProviderId;
  title?: string;
  binary?: string;
  workspace?: string;
  sharedReposDir?: string;
  sharedReposExists?: boolean;
  version?: string | null;
  versionCheckedAt?: string | null;
  session?: SessionSummary;
  authJob?: SessionSummary;
  authStatus?: AuthStatus;
  personaPreference?: PersonaPref;
  capabilities?: {
    authStatus?: boolean;
    authLogout?: boolean;
  };
  access?: {
    fullHomeAccess?: boolean;
    homeDir?: string;
    sharedReposDir?: string;
    approvalModeLocked?: boolean;
  };
  lastComposerInteraction?: {
    at?: string;
    promptPreview?: string;
    persona?: { id?: string; name?: string; voiceId?: string };
  } | null;
};

type ProviderEnvelope = {
  ok?: boolean;
  provider?: ProviderInfo;
  error?: string;
};

type PersonaEntry = {
  id: string;
  name: string;
  voiceId?: string;
};

type PersonasEnvelope = {
  ok?: boolean;
  personas?: PersonaEntry[];
  error?: string;
};

type PersonaSendResponse = {
  ok?: boolean;
  persona?: { id?: string; name?: string; voiceId?: string };
  mode?: string;
  error?: string;
};

type AudioEntry = {
  title: string;
  url: string;
  type?: string;
  voice?: string;
};

type NarrationResponse = {
  ok?: boolean;
  summaryText?: string;
  generatedAt?: string;
  persona?: { id?: string; name?: string; voiceId?: string };
  audioPlaylist?: AudioEntry[];
  source?: { chars?: number; promptAt?: string; promptPreview?: string };
  error?: string;
};

type AuthHint = {
  url?: string;
  code?: string;
  text?: string;
};

const PROVIDER_COPY: Record<ProviderId, { title: string; subtitle: string }> = {
  codex: {
    title: 'ChatGPT Codex CLI',
    subtitle: 'Browser terminal for Codex CLI with persona composer and narrated summaries.'
  },
  claude: {
    title: 'Claude Code CLI',
    subtitle: 'Browser terminal for Claude Code with browser auth flow and dashboard persona tools.'
  },
  gemini: {
    title: 'Gemini Code CLI',
    subtitle: 'Browser terminal for Gemini Code CLI with YOLO-mode launch and persona narration.'
  }
};

function fmtDateTime(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

function buildWsUrl(provider: ProviderId, channel: 'main' | 'auth'): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(`${proto}//${window.location.host}/api/ai-cli/ws`);
  url.searchParams.set('provider', provider);
  url.searchParams.set('channel', channel);
  return url.toString();
}

function trimLogTail(raw: string, maxChars: number): string {
  const t = String(raw || '');
  if (t.length <= maxChars) return t;
  return t.slice(t.length - maxChars);
}

function safeCopyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.top = '-1000px';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      if (!ok) reject(new Error('Copy failed'));
      else resolve();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

@Component({
  selector: 'app-ai-cli-terminal',
  imports: [RouterLink, FormsModule],
  templateUrl: './ai-cli-terminal.component.html',
  styleUrl: './ai-cli-terminal.component.scss'
})
export class AiCliTerminalComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('termHost') private readonly termHost?: ElementRef<HTMLDivElement>;

  protected readonly providerId: ProviderId;
  protected readonly providerCopy: { title: string; subtitle: string };

  protected readonly loading = signal(true);
  protected readonly actionBusy = signal(false);
  protected readonly error = signal('');
  protected readonly toast = signal('');

  protected readonly provider = signal<ProviderInfo | null>(null);
  protected readonly personas = signal<PersonaEntry[]>([]);

  protected readonly composerMode = signal<'selected' | 'random'>('selected');
  protected readonly selectedPersonaId = signal('');
  protected readonly composerText = signal('');
  protected readonly composerBusy = signal(false);
  protected readonly composerError = signal('');
  protected readonly lastComposerPersona = signal('');

  protected readonly narrationBusy = signal(false);
  protected readonly narrationError = signal('');
  protected readonly narrationSummary = signal('');
  protected readonly narrationAudioUrl = signal('');
  protected readonly narrationPersona = signal('');
  protected readonly narrationGeneratedAt = signal('');
  protected readonly narrationSourceChars = signal<number | null>(null);

  protected readonly authLog = signal('');
  protected readonly authHints = signal<AuthHint[]>([]);

  protected readonly mainConnected = signal(false);
  protected readonly authConnected = signal(false);

  protected readonly formattedStartedAt = computed(() => fmtDateTime(this.provider()?.session?.startedAt || null));
  protected readonly formattedExitedAt = computed(() => fmtDateTime(this.provider()?.session?.exitedAt || null));
  protected readonly formattedAuthCheckedAt = computed(() => fmtDateTime(this.provider()?.authStatus?.checkedAt || null));
  protected readonly formattedNarrationAt = computed(() => fmtDateTime(this.narrationGeneratedAt() || null));

  protected readonly isMainRunning = computed(() => this.provider()?.session?.running === true);
  protected readonly isMainStopping = computed(() => this.provider()?.session?.stopping === true);
  protected readonly isAuthRunning = computed(() => this.provider()?.authJob?.running === true);

  protected readonly authStatusLabel = computed(() => {
    const raw = String(this.provider()?.authStatus?.status || 'unknown').toLowerCase();
    if (raw === 'logged_in') return 'Logged In';
    if (raw === 'logged_out') return 'Logged Out';
    if (raw === 'error') return 'Error';
    return 'Unknown';
  });

  protected readonly authStatusClass = computed(() => {
    const raw = String(this.provider()?.authStatus?.status || 'unknown').toLowerCase();
    if (raw === 'logged_in') return 'good';
    if (raw === 'logged_out') return 'warn';
    if (raw === 'error') return 'bad';
    return 'muted';
  });

  protected readonly mainConnectionLabel = computed(() => {
    if (this.mainConnected()) return 'Connected';
    if (this.isMainRunning()) return 'Disconnected (reconnect pending)';
    return 'Idle';
  });

  protected readonly authConnectionLabel = computed(() => {
    if (this.authConnected()) return 'Streaming';
    if (this.isAuthRunning()) return 'Auth Job Running';
    return 'Idle';
  });

  protected readonly selectedPersonaLabel = computed(() => {
    const id = this.selectedPersonaId();
    const match = this.personas().find((p) => p.id === id);
    return match ? match.name : '—';
  });

  protected readonly personaButtonLabel = computed(() =>
    this.composerMode() === 'random' ? 'Send via Random Persona' : 'Send via Persona'
  );

  protected readonly canSendPersona = computed(() => {
    if (this.composerBusy()) return false;
    if (!this.isMainRunning()) return false;
    return this.composerText().trim().length > 0;
  });

  protected readonly hasNarrationAudio = computed(() => Boolean(this.narrationAudioUrl()));
  protected readonly workspacePath = computed(() => this.provider()?.workspace || '—');
  protected readonly sharedReposPath = computed(
    () => this.provider()?.sharedReposDir || this.provider()?.access?.sharedReposDir || '—'
  );
  protected readonly providerVersion = computed(() => this.provider()?.version || '—');

  private term: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private mainWs: WebSocket | null = null;
  private authWs: WebSocket | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private pendingTerminalData: string[] = [];
  private toastTimer: number | null = null;
  private pollTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private refreshing = false;

  constructor(private readonly route: ActivatedRoute) {
    const raw = String(this.route.snapshot.data['provider'] || 'codex').trim();
    this.providerId = (raw === 'claude' || raw === 'gemini' ? raw : 'codex') as ProviderId;
    this.providerCopy = PROVIDER_COPY[this.providerId];
  }

  ngOnInit(): void {
    void this.loadInitial();
    this.startPolling();
  }

  ngAfterViewInit(): void {
    this.initTerminal();
    this.flushPendingTerminalData();
    if (this.isMainRunning()) {
      this.ensureMainSocket();
    }
  }

  ngOnDestroy(): void {
    this.clearTimers();
    this.closeMainSocket();
    this.closeAuthSocket();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.term?.dispose();
    this.term = null;
  }

  protected async startSession(): Promise<void> {
    await this.sessionAction('start');
    this.ensureMainSocket();
  }

  protected async stopSession(): Promise<void> {
    await this.sessionAction('stop');
    if (!this.isMainRunning()) {
      this.closeMainSocket();
    }
  }

  protected async restartSession(): Promise<void> {
    await this.sessionAction('restart');
    this.term?.clear();
    this.ensureMainSocket();
  }

  protected async refreshStatus(): Promise<void> {
    await this.refreshProvider(true);
  }

  protected async login(): Promise<void> {
    this.error.set('');
    this.authHints.set([]);
    this.authLog.set('');
    await this.post(`/api/ai-cli/session/${this.providerId}/auth/login`, {});
    await this.refreshProvider(false);
    this.ensureAuthSocket();
  }

  protected async stopAuthJob(): Promise<void> {
    this.error.set('');
    await this.post(`/api/ai-cli/session/${this.providerId}/auth/stop`, {});
    await this.refreshProvider(false);
    if (!this.isAuthRunning()) this.closeAuthSocket();
  }

  protected async refreshAuthStatus(): Promise<void> {
    this.error.set('');
    try {
      const data = await this.post<{ ok?: boolean; providerState?: ProviderInfo; authStatus?: AuthStatus; error?: string }>(
        `/api/ai-cli/session/${this.providerId}/auth/status`,
        {}
      );
      if (data?.providerState) this.provider.set(data.providerState);
      else await this.refreshProvider(false);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected async logout(): Promise<void> {
    this.error.set('');
    try {
      await this.post(`/api/ai-cli/session/${this.providerId}/auth/logout`, {});
      await this.refreshProvider(false);
      this.pushToast('Logout command completed');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected clearTerminalView(): void {
    this.term?.clear();
  }

  protected onComposerInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    this.composerText.set(target.value || '');
  }

  protected onPersonaSelect(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    this.selectedPersonaId.set(target.value || '');
    this.composerMode.set('selected');
  }

  protected setComposerMode(mode: 'selected' | 'random'): void {
    this.composerMode.set(mode);
  }

  protected async sendViaPersona(): Promise<void> {
    this.composerError.set('');
    this.error.set('');
    const text = this.composerText().trim();
    if (!text) {
      this.composerError.set('Enter a prompt first.');
      return;
    }
    if (!this.isMainRunning()) {
      this.composerError.set('Start the terminal session first.');
      return;
    }

    this.composerBusy.set(true);
    try {
      const payload = {
        text,
        mode: this.composerMode(),
        personaId: this.composerMode() === 'selected' ? this.selectedPersonaId() : undefined
      };
      const data = await this.post<PersonaSendResponse>(`/api/ai-cli/session/${this.providerId}/persona/send`, payload);
      if (!data || data.ok !== true) throw new Error(data?.error || 'Failed to send persona prompt');
      this.lastComposerPersona.set(data.persona?.name ? String(data.persona.name) : '');
      this.composerText.set('');
      this.pushToast(`Sent via ${data.persona?.name || 'persona'}`);
      await this.refreshProvider(false);
    } catch (e) {
      this.composerError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.composerBusy.set(false);
    }
  }

  protected async narrateLast(): Promise<void> {
    this.narrationBusy.set(true);
    this.narrationError.set('');
    this.error.set('');
    try {
      const payload = {
        mode: this.composerMode(),
        personaId: this.composerMode() === 'selected' ? this.selectedPersonaId() : undefined
      };
      const data = await this.post<NarrationResponse>(`/api/ai-cli/session/${this.providerId}/narrate-last`, payload);
      if (!data || data.ok !== true) throw new Error(data?.error || 'Narration failed');
      this.narrationSummary.set(String(data.summaryText || '').trim());
      this.narrationGeneratedAt.set(String(data.generatedAt || ''));
      this.narrationPersona.set(data.persona?.name ? String(data.persona.name) : '');
      this.narrationSourceChars.set(
        typeof data.source?.chars === 'number' && Number.isFinite(data.source.chars) ? data.source.chars : null
      );
      const firstAudio = Array.isArray(data.audioPlaylist) ? data.audioPlaylist[0] : null;
      this.narrationAudioUrl.set(firstAudio?.url ? String(firstAudio.url) : '');
      if (!firstAudio?.url) {
        this.pushToast('Summary generated (no audio file; check Inworld keys/voice config).');
      }
    } catch (e) {
      this.narrationError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.narrationBusy.set(false);
    }
  }

  protected async copyWorkspace(): Promise<void> {
    await this.copyText(this.workspacePath(), 'Workspace path copied');
  }

  protected async copySharedRepos(): Promise<void> {
    await this.copyText(this.sharedReposPath(), 'Shared repos path copied');
  }

  protected trackPersona(_index: number, p: PersonaEntry): string {
    return p.id;
  }

  protected authHintLabel(h: AuthHint): string {
    if (h.code) return `Code: ${h.code}`;
    if (h.url) return h.url;
    return h.text || 'Auth hint';
  }

  protected authHintUrl(h: AuthHint): string {
    return h.url || '';
  }

  private async loadInitial(): Promise<void> {
    this.loading.set(true);
    this.error.set('');

    try {
      await Promise.all([this.loadPersonas(), this.refreshProvider(false)]);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }

  private initTerminal(): void {
    if (typeof window === 'undefined') return;
    if (!this.termHost?.nativeElement) return;
    if (this.term) return;

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#070b13',
        foreground: '#d8ecff',
        cursor: '#7ee6d7',
        selectionBackground: 'rgba(126, 230, 215, 0.25)',
        black: '#0b1018',
        red: '#ff7d92',
        green: '#86efac',
        yellow: '#f8d66d',
        blue: '#7cb9ff',
        magenta: '#c58bff',
        cyan: '#7ee6d7',
        white: '#dce9f7',
        brightBlack: '#4d6278',
        brightRed: '#ff9eb0',
        brightGreen: '#a6f4c7',
        brightYellow: '#ffe48f',
        brightBlue: '#9bccff',
        brightMagenta: '#d5a8ff',
        brightCyan: '#a6f7ec',
        brightWhite: '#f5fbff'
      }
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(this.termHost.nativeElement);
    this.term = term;
    this.fitAddon = fitAddon;

    term.onData((data) => {
      const ws = this.mainWs;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'input', data }));
    });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.fitTerminal());
      this.resizeObserver.observe(this.termHost.nativeElement);
    }

    window.setTimeout(() => this.fitTerminal(), 20);
  }

  private fitTerminal(): void {
    if (!this.term || !this.fitAddon) return;
    try {
      this.fitAddon.fit();
      const cols = this.term.cols;
      const rows = this.term.rows;
      if (cols > 0 && rows > 0) {
        const ws = this.mainWs;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      }
    } catch {
      // ignore fit/resize errors
    }
  }

  private flushPendingTerminalData(): void {
    if (!this.term || !this.pendingTerminalData.length) return;
    for (const chunk of this.pendingTerminalData) {
      this.term.write(chunk);
    }
    this.pendingTerminalData = [];
  }

  private writeTerminal(data: string): void {
    const text = String(data || '');
    if (!text) return;
    if (!this.term) {
      this.pendingTerminalData.push(text);
      if (this.pendingTerminalData.length > 200) {
        this.pendingTerminalData = this.pendingTerminalData.slice(this.pendingTerminalData.length - 200);
      }
      return;
    }
    this.term.write(text);
  }

  private ensureMainSocket(): void {
    if (typeof window === 'undefined') return;
    if (this.mainWs && (this.mainWs.readyState === WebSocket.OPEN || this.mainWs.readyState === WebSocket.CONNECTING)) return;

    const ws = new WebSocket(buildWsUrl(this.providerId, 'main'));
    this.mainWs = ws;

    ws.onopen = () => {
      this.mainConnected.set(true);
      this.error.set('');
      this.fitTerminal();
    };

    ws.onmessage = (event) => {
      this.handleMainWsMessage(event.data);
    };

    ws.onerror = () => {
      this.mainConnected.set(false);
    };

    ws.onclose = () => {
      this.mainConnected.set(false);
      if (this.mainWs === ws) this.mainWs = null;
      this.scheduleMainReconnect();
    };
  }

  private ensureAuthSocket(): void {
    if (typeof window === 'undefined') return;
    if (this.authWs && (this.authWs.readyState === WebSocket.OPEN || this.authWs.readyState === WebSocket.CONNECTING)) return;

    const ws = new WebSocket(buildWsUrl(this.providerId, 'auth'));
    this.authWs = ws;

    ws.onopen = () => {
      this.authConnected.set(true);
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
      if (this.isAuthRunning()) {
        window.setTimeout(() => this.ensureAuthSocket(), 1200);
      }
    };
  }

  private closeMainSocket(): void {
    if (!this.mainWs) return;
    try {
      this.mainWs.close();
    } catch {
      // ignore
    }
    this.mainWs = null;
    this.mainConnected.set(false);
  }

  private closeAuthSocket(): void {
    if (!this.authWs) return;
    try {
      this.authWs.close();
    } catch {
      // ignore
    }
    this.authWs = null;
    this.authConnected.set(false);
  }

  private scheduleMainReconnect(): void {
    if (!this.isMainRunning()) return;
    if (this.reconnectTimer != null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isMainRunning()) this.ensureMainSocket();
    }, 1200);
  }

  private handleMainWsMessage(raw: unknown): void {
    let msg: any;
    try {
      msg = JSON.parse(String(raw || ''));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const type = String(msg.type || '');

    if (type === 'snapshot' || type === 'output') {
      this.writeTerminal(String(msg.data || ''));
      return;
    }

    if (type === 'hello') {
      this.applyStatePayload(msg.state);
      return;
    }

    if (type === 'state') {
      this.applyStatePayload(msg);
      return;
    }

    if (type === 'exit') {
      void this.refreshProvider(false);
      return;
    }

    if (type === 'error') {
      const message = String(msg.message || '').trim();
      if (message) this.error.set(message);
      return;
    }
  }

  private handleAuthWsMessage(raw: unknown): void {
    let msg: any;
    try {
      msg = JSON.parse(String(raw || ''));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const type = String(msg.type || '');

    if (type === 'hello') {
      this.applyStatePayload(msg.state);
      return;
    }

    if (type === 'state') {
      this.applyStatePayload(msg);
      return;
    }

    if (type === 'snapshot' || type === 'output') {
      const next = trimLogTail(this.authLog() + String(msg.data || ''), 50_000);
      this.authLog.set(next);
      return;
    }

    if (type === 'auth_hint') {
      const hint: AuthHint = {
        url: msg.url ? String(msg.url) : undefined,
        code: msg.code ? String(msg.code) : undefined,
        text: msg.text ? String(msg.text) : undefined
      };
      const curr = this.authHints();
      const dupe = curr.some((h) => h.url === hint.url && h.code === hint.code && h.text === hint.text);
      if (!dupe) this.authHints.set([...curr, hint].slice(-8));
      return;
    }

    if (type === 'error') {
      const message = String(msg.message || '').trim();
      if (message) this.error.set(message);
      return;
    }

    if (type === 'exit') {
      void this.refreshProvider(false);
      return;
    }
  }

  private applyStatePayload(payload: any): void {
    if (!payload || typeof payload !== 'object') return;

    const current = this.provider();
    if (!current) return;

    const next: ProviderInfo = {
      ...current,
      session: payload.session ? { ...(current.session || {}), ...payload.session } : current.session,
      authJob: payload.authJob ? { ...(current.authJob || {}), ...payload.authJob } : current.authJob,
      authStatus: payload.authStatus ? { ...(current.authStatus || {}), ...payload.authStatus } : current.authStatus,
      lastComposerInteraction:
        Object.prototype.hasOwnProperty.call(payload, 'lastComposerInteraction') && payload.lastComposerInteraction
          ? payload.lastComposerInteraction
          : current.lastComposerInteraction
    };

    this.provider.set(next);

    if (next.session?.running) {
      this.ensureMainSocket();
    }
    if (next.authJob?.running) {
      this.ensureAuthSocket();
    }
  }

  private startPolling(): void {
    if (typeof window === 'undefined') return;
    if (this.pollTimer != null) return;
    this.pollTimer = window.setInterval(() => {
      void this.refreshProvider(false);
    }, 5000);
  }

  private clearTimers(): void {
    if (this.toastTimer != null) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.pollTimer != null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async loadPersonas(): Promise<void> {
    const data = await this.get<PersonasEnvelope>('/api/ai-cli/personas');
    const list = Array.isArray(data.personas) ? data.personas : [];
    this.personas.set(list);

    const preferredId = this.provider()?.personaPreference?.personaId || '';
    const existing = list.find((p) => p.id === preferredId);
    const first = list[0];
    this.selectedPersonaId.set(existing?.id || first?.id || '');
  }

  private async refreshProvider(manual: boolean): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    if (manual) this.error.set('');

    try {
      const data = await this.get<ProviderEnvelope>(`/api/ai-cli/session/${this.providerId}`);
      if (!data || data.ok !== true || !data.provider) throw new Error(data?.error || 'Failed to load provider status');
      this.provider.set(data.provider);

      const mode = String(data.provider.personaPreference?.mode || '').trim().toLowerCase();
      this.composerMode.set(mode === 'random' ? 'random' : 'selected');

      const prefId = String(data.provider.personaPreference?.personaId || '').trim();
      if (prefId) {
        this.selectedPersonaId.set(prefId);
      } else if (!this.selectedPersonaId() && this.personas().length) {
        this.selectedPersonaId.set(this.personas()[0]!.id);
      }

      if (data.provider.session?.running) this.ensureMainSocket();
      else if (this.mainWs && this.mainWs.readyState !== WebSocket.CONNECTING) this.closeMainSocket();

      if (data.provider.authJob?.running) this.ensureAuthSocket();
      else if (this.authWs && this.authWs.readyState !== WebSocket.CONNECTING) this.closeAuthSocket();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.refreshing = false;
    }
  }

  private async sessionAction(action: 'start' | 'stop' | 'restart'): Promise<void> {
    this.actionBusy.set(true);
    this.error.set('');
    try {
      const data = await this.post<ProviderEnvelope>(`/api/ai-cli/session/${this.providerId}/${action}`, {});
      if (!data || data.ok !== true) throw new Error(data?.error || `${action} failed`);
      if (data.provider) this.provider.set(data.provider);
      await this.refreshProvider(false);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.actionBusy.set(false);
    }
  }

  private async copyText(text: string, toastMessage: string): Promise<void> {
    try {
      await safeCopyText(String(text || ''));
      this.pushToast(toastMessage);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  private pushToast(message: string): void {
    this.toast.set(message);
    if (this.toastTimer != null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastTimer = null;
      this.toast.set('');
    }, 2200);
  }

  private async get<T>(url: string): Promise<T> {
    const r = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  }

  private async post<T>(url: string, body: unknown): Promise<T> {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      cache: 'no-store',
      body: JSON.stringify(body ?? {})
    });
    const data = (await r.json().catch(() => ({}))) as T & { error?: string; ok?: boolean };
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data as T;
  }
}
