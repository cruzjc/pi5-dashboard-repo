import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';

type BlockInfo = {
  height?: number | null;
  previousblockhash?: string;
  bits?: string;
  curtime?: number;
  bestblockhash?: string;
  mediantime?: number | null;
  tip_time?: number | null;
  next_bits?: string;
  chain?: string;
};

type QuotaState = {
  remaining_total?: number;
  remaining_auto?: number;
  used_total?: number;
  used_manual?: number;
  used_auto?: number;
  total_quota?: number;
  reserved_manual?: number;
};

type AutoEntryConfig = {
  auto_miner_enabled: boolean;
  auto_miner_total_hash_attempts: number;
  auto_miner_max_seeds: number;
  auto_miner_submit_as_manual: boolean;
  miner_payout_address: string;
  miner_payout_script_pubkey_hex: string;
  timer_active: boolean | null;
  running: boolean;
  log_updated_at: string | null;
};

type MineResult = {
  nonce: string;
  hash: string;
  zeros: number;
  pct: string;
  win: boolean;
};

const LS_PREFIX = 'pi5-dashboard.bitcoinLottery.v1.';

function lsGet(key: string, fallback = ''): string {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const v = localStorage.getItem(LS_PREFIX + key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_PREFIX + key, value);
  } catch {
    // ignore
  }
}

function bytesToHex(b: ArrayBuffer): string {
  return Array.from(new Uint8Array(b))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(buf: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', buf);
}

async function sha256HexUtf8(s: string): Promise<string> {
  const b = new TextEncoder().encode(s);
  const h1 = await sha256(b.buffer);
  const h2 = await sha256(h1);
  return bytesToHex(h2);
}

function countLeadingZerosHex(h: string): number {
  let c = 0;
  for (const ch of h) {
    if (ch === '0') c++;
    else break;
  }
  return c;
}

function genVars(s: string): string[] {
  const v = new Set<string>();
  const raw = s ?? '';
  if (!raw.trim()) return [];
  v.add(raw);

  const dm = raw.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (dm) {
    const [, p1, p2, p3] = dm;
    v.add(`${p1}/${p2}/${p3}`);
    v.add(`${p1}${p2}${p3}`);
  }

  if (/[a-z]/i.test(raw)) {
    v.add(raw.toLowerCase());
    v.add(raw.toUpperCase());
    v.add(raw.replace(/\s/g, ''));
  }

  const numeric = raw.replace(/[\s,\-]/g, '');
  if (/^\d+$/.test(numeric)) {
    v.add(numeric);
    v.add(numeric.split('').reverse().join(''));
  }

  return Array.from(v).slice(0, 10);
}

@Component({
  selector: 'app-bitcoin-lottery',
  templateUrl: './bitcoin-lottery.component.html',
  styleUrl: './bitcoin-lottery.component.scss'
})
export class BitcoinLotteryComponent implements OnInit, OnDestroy {
  private blockInterval: number | null = null;
  private auxInterval: number | null = null;

  protected readonly proxyUrl = signal(lsGet('proxyUrl', 'http://192.168.4.12/bitcoin'));
  protected readonly apiKey = signal(lsGet('apiKey', ''));

  protected readonly status = signal<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  protected readonly error = signal('');

  protected readonly block = signal<BlockInfo | null>(null);
  protected readonly quota = signal<QuotaState | null>(null);

  protected readonly cfgLoading = signal(false);
  protected readonly cfgSaving = signal(false);
  protected readonly cfgMsg = signal('');

  protected readonly wallet = signal(lsGet('wallet', ''));
  protected readonly soloEnabled = signal(false);
  protected readonly hashAttempts = signal(20000);
  protected readonly maxSeeds = signal(8);
  protected readonly submitAsManual = signal(true);
  protected readonly scriptPubKeyHex = signal('');

  protected readonly timerActive = signal<boolean | null>(null);
  protected readonly autoRunning = signal(false);
  protected readonly autoPid = signal<number | null>(null);
  protected readonly logUpdatedAt = signal<string | null>(null);

  protected readonly logsLoading = signal(false);
  protected readonly logs = signal<string[]>([]);

  protected readonly input = signal('');
  protected readonly variations = signal<string[]>([]);
  protected readonly mining = signal(false);
  protected readonly results = signal<MineResult[]>([]);

  protected readonly hasAuth = computed(() => !!this.proxyUrl().trim() && !!this.apiKey().trim());

  ngOnInit(): void {
    // Initial load.
    void this.refreshAll();

    // Keep it feeling live.
    this.blockInterval = window.setInterval(() => void this.fetchBlockInfo(), 30_000);
    this.auxInterval = window.setInterval(() => void this.refreshAux(true), 20_000);
  }

  ngOnDestroy(): void {
    if (this.blockInterval != null) window.clearInterval(this.blockInterval);
    if (this.auxInterval != null) window.clearInterval(this.auxInterval);
  }

  protected persist(): void {
    lsSet('proxyUrl', this.proxyUrl().trim());
    lsSet('apiKey', this.apiKey());
    lsSet('wallet', this.wallet());
  }

  protected async refreshAll(): Promise<void> {
    await Promise.all([this.fetchBlockInfo(), this.refreshAux(false)]);
  }

  protected async refreshAux(silent: boolean): Promise<void> {
    await Promise.all([this.fetchAutoConfig(silent), this.fetchLogs(silent), this.fetchQuota(silent)]);
  }

  private headers(extra?: Record<string, string>): HeadersInit {
    return {
      'Accept': 'application/json',
      'X-API-Key': this.apiKey().trim(),
      ...(extra ?? {})
    };
  }

  private normalizeBaseUrl(): string {
    return this.proxyUrl().trim().replace(/\/+$/, '');
  }

  protected async fetchBlockInfo(): Promise<void> {
    if (!this.hasAuth()) {
      this.status.set('idle');
      this.error.set('Set Proxy URL + API key to connect.');
      return;
    }

    this.status.set('connecting');
    this.error.set('');

    try {
      const r = await fetch(`${this.normalizeBaseUrl()}/blockinfo`, {
        method: 'GET',
        headers: this.headers(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (d?.result) {
        this.block.set(d.result as BlockInfo);
        this.status.set('connected');
      } else {
        throw new Error('No result');
      }
    } catch (e) {
      this.status.set('error');
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected async fetchQuota(silent: boolean): Promise<void> {
    if (!this.hasAuth()) {
      this.quota.set(null);
      return;
    }
    try {
      const r = await fetch(`${this.normalizeBaseUrl()}/quota`, {
        method: 'GET',
        headers: this.headers(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      this.quota.set(d as QuotaState);
    } catch (e) {
      if (!silent) this.cfgMsg.set(`Quota error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  protected async fetchAutoConfig(silent: boolean): Promise<void> {
    if (!silent) {
      this.cfgLoading.set(true);
      this.cfgMsg.set('');
    }

    if (!this.hasAuth()) {
      this.cfgLoading.set(false);
      return;
    }

    try {
      const r = await fetch(`${this.normalizeBaseUrl()}/auto-entry/config`, {
        method: 'GET',
        headers: this.headers(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as AutoEntryConfig;

      this.soloEnabled.set(!!d.auto_miner_enabled);
      this.hashAttempts.set(d.auto_miner_total_hash_attempts ?? 20000);
      this.maxSeeds.set(d.auto_miner_max_seeds ?? 8);
      this.submitAsManual.set(!!d.auto_miner_submit_as_manual);
      this.scriptPubKeyHex.set(d.miner_payout_script_pubkey_hex || '');
      this.timerActive.set(typeof d.timer_active === 'boolean' ? d.timer_active : null);
      this.autoRunning.set(!!d.running);
      this.logUpdatedAt.set(d.log_updated_at ?? null);

      if (d.miner_payout_address) {
        this.wallet.set(d.miner_payout_address);
      }

      // best-effort: if running but no pid, keep whatever we had
      if (!d.running) this.autoPid.set(null);

      this.persist();
    } catch (e) {
      if (!silent) this.cfgMsg.set(`Config error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (!silent) this.cfgLoading.set(false);
    }
  }

  protected async saveAutoConfig(): Promise<void> {
    this.cfgSaving.set(true);
    this.cfgMsg.set('');

    try {
      const body = {
        auto_miner_enabled: !!this.soloEnabled(),
        auto_miner_total_hash_attempts: Number(this.hashAttempts()),
        auto_miner_max_seeds: Number(this.maxSeeds()),
        auto_miner_submit_as_manual: !!this.submitAsManual(),
        miner_payout_address: (this.wallet() || '').trim(),
        miner_payout_script_pubkey_hex: (this.scriptPubKeyHex() || '').trim(),
      };

      const r = await fetch(`${this.normalizeBaseUrl()}/auto-entry/config`, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });

      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);

      this.persist();
      this.cfgMsg.set('Saved settings');
      await this.fetchAutoConfig(true);
    } catch (e) {
      this.cfgMsg.set(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.cfgSaving.set(false);
    }
  }

  protected async runAutoEntryNow(): Promise<void> {
    this.cfgMsg.set('');

    try {
      const r = await fetch(`${this.normalizeBaseUrl()}/auto-entry/run`, {
        method: 'POST',
        headers: this.headers(),
      });

      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);

      this.autoPid.set(typeof d?.pid === 'number' ? d.pid : null);
      this.autoRunning.set(true);
      this.cfgMsg.set(this.autoPid() ? `Run started (pid ${this.autoPid()})` : 'Run started');

      void this.fetchLogs(true);
      window.setTimeout(() => void this.fetchAutoConfig(true), 1200);
    } catch (e) {
      this.cfgMsg.set(`Run failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  protected async fetchLogs(silent: boolean): Promise<void> {
    if (!silent) this.logsLoading.set(true);

    if (!this.hasAuth()) {
      this.logsLoading.set(false);
      return;
    }

    try {
      const r = await fetch(`${this.normalizeBaseUrl()}/auto-entry/log?lines=120`, {
        method: 'GET',
        headers: this.headers(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      this.logs.set(Array.isArray(d?.lines) ? (d.lines as string[]) : []);
    } catch (e) {
      if (!silent) this.cfgMsg.set(`Log error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (!silent) this.logsLoading.set(false);
    }
  }

  protected generateVariations(): void {
    this.variations.set(genVars(this.input()));
    this.results.set([]);
  }

  protected async mineAll(): Promise<void> {
    const b = this.block();
    if (!b?.previousblockhash || !b?.curtime || !b?.bits) {
      this.error.set('No block data yet.');
      return;
    }

    this.mining.set(true);
    this.results.set([]);
    this.error.set('');

    try {
      const out: MineResult[] = [];
      for (const v of this.variations()) {
        const h = await sha256HexUtf8(`${b.previousblockhash}${b.curtime}${b.bits}${v}`);
        const z = countLeadingZerosHex(h);
        out.push({
          nonce: v,
          hash: h,
          zeros: z,
          win: z >= 19,
          pct: ((z / 19) * 100).toFixed(1),
        });
      }
      this.results.set(out);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.mining.set(false);
    }
  }
}
