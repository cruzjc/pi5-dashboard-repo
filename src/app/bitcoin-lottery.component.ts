import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { sha256 } from '@noble/hashes/sha2.js';

type RuntimeConfig = {
  bitcoinLottery?: {
    proxyUrl?: string;
    apiKey?: string;
    wallet?: string;
  };
};

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
  seed: string;
  attempts: number;
  bestNonce: number;
  bestHash: string;
  hit: boolean;
  hitNonce?: number;
  hitHash?: string;
};

const LS_PREFIX = 'pi5-dashboard.bitcoinLottery.v1.';

function lsHas(key: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(LS_PREFIX + key) != null;
  } catch {
    return false;
  }
}

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

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  let h = (hex || '').trim();
  if (h.startsWith('0x') || h.startsWith('0X')) h = h.slice(2);
  if (!h) return new Uint8Array();
  if (h.length % 2 !== 0) throw new Error('Invalid hex length');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    const v = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(v)) throw new Error('Invalid hex');
    out[i] = v;
  }
  return out;
}

function reverseBytes(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b[b.length - 1 - i];
  return out;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function u16LE(n: number): Uint8Array {
  const x = n & 0xffff;
  return new Uint8Array([x & 0xff, (x >>> 8) & 0xff]);
}

function u32LE(n: number): Uint8Array {
  const x = n >>> 0;
  return new Uint8Array([x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff]);
}

function u64LE(n: bigint): Uint8Array {
  let x = n;
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function readU32LE(b: Uint8Array, offset = 0): number {
  return (
    (b[offset] ?? 0) |
    ((b[offset + 1] ?? 0) << 8) |
    ((b[offset + 2] ?? 0) << 16) |
    ((b[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function leBytesToBigInt(b: Uint8Array): bigint {
  let x = 0n;
  for (let i = b.length - 1; i >= 0; i--) {
    x = (x << 8n) + BigInt(b[i]!);
  }
  return x;
}

function hash256(b: Uint8Array): Uint8Array {
  return sha256(sha256(b));
}

function compactToTarget(bitsHex: string): bigint {
  const bits = BigInt('0x' + bitsHex);
  const exp = Number(bits >> 24n);
  const mant = bits & 0xff_ffffn;
  if (exp <= 3) return mant >> BigInt(8 * (3 - exp));
  return mant << BigInt(8 * (exp - 3));
}

function varInt(n: number | bigint): Uint8Array {
  const v = typeof n === 'bigint' ? n : BigInt(n);
  if (v < 0n) throw new Error('varint must be non-negative');
  if (v < 0xfdn) return new Uint8Array([Number(v)]);
  if (v <= 0xffffn) return concatBytes(new Uint8Array([0xfd]), u16LE(Number(v)));
  if (v <= 0xffff_ffffn) return concatBytes(new Uint8Array([0xfe]), u32LE(Number(v)));
  return concatBytes(new Uint8Array([0xff]), u64LE(v));
}

function scriptNumEncode(n: number): Uint8Array {
  if (n === 0) return new Uint8Array();
  const neg = n < 0;
  let abs = Math.abs(n);
  const out: number[] = [];
  while (abs) {
    out.push(abs & 0xff);
    abs = Math.floor(abs / 256);
  }

  if (out[out.length - 1]! & 0x80) out.push(neg ? 0x80 : 0x00);
  else if (neg) out[out.length - 1] = out[out.length - 1]! | 0x80;

  return new Uint8Array(out);
}

function pushData(data: Uint8Array): Uint8Array {
  const n = data.length;
  if (n < 0x4c) return concatBytes(new Uint8Array([n]), data);
  if (n <= 0xff) return concatBytes(new Uint8Array([0x4c, n]), data);
  if (n <= 0xffff) return concatBytes(new Uint8Array([0x4d]), u16LE(n), data);
  return concatBytes(new Uint8Array([0x4e]), u32LE(n), data);
}

function blockSubsidySats(height: number): bigint {
  const halvings = Math.floor(height / 210000);
  if (halvings >= 64) return 0n;
  let subsidy = 50n * 100_000_000n;
  subsidy >>= BigInt(halvings);
  return subsidy;
}

function buildCoinbaseTx(height: number, scriptPubKey: Uint8Array, tag: Uint8Array): Uint8Array {
  const hb = scriptNumEncode(height);
  const scriptSig = concatBytes(pushData(hb), pushData(tag));
  if (scriptSig.length < 2 || scriptSig.length > 100) {
    throw new Error(`coinbase scriptSig length out of range: ${scriptSig.length}`);
  }

  const value = blockSubsidySats(height);

  return concatBytes(
    u32LE(2),
    varInt(1),
    new Uint8Array(32),
    new Uint8Array([0xff, 0xff, 0xff, 0xff]),
    varInt(scriptSig.length),
    scriptSig,
    new Uint8Array([0xff, 0xff, 0xff, 0xff]),
    varInt(1),
    u64LE(value),
    varInt(scriptPubKey.length),
    scriptPubKey,
    u32LE(0)
  );
}

function merkleRootLE(txidsLE: Uint8Array[]): Uint8Array {
  if (!txidsLE.length) return new Uint8Array(32);
  let layer = txidsLE.slice();
  while (layer.length > 1) {
    if (layer.length % 2 === 1) layer.push(layer[layer.length - 1]!);
    const nxt: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      nxt.push(hash256(concatBytes(layer[i]!, layer[i + 1]!)));
    }
    layer = nxt;
  }
  return layer[0]!;
}

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP: Record<string, number> = Object.fromEntries(
  B58_ALPHABET.split('').map((c, i) => [c, i])
) as Record<string, number>;

function base58checkDecode(s: string): Uint8Array {
  const raw = (s || '').trim();
  if (!raw) throw new Error('empty base58 string');

  let n = 0n;
  for (const ch of raw) {
    const v = B58_MAP[ch];
    if (v == null) throw new Error(`invalid base58 char: ${JSON.stringify(ch)}`);
    n = n * 58n + BigInt(v);
  }

  const bytes: number[] = [];
  while (n > 0n) {
    bytes.push(Number(n & 0xffn));
    n >>= 8n;
  }
  bytes.reverse();

  let pad = 0;
  for (const ch of raw) {
    if (ch === '1') pad++;
    else break;
  }

  const full = new Uint8Array(pad + bytes.length);
  full.set(bytes, pad);

  if (full.length < 4) throw new Error('base58 string too short');
  const payload = full.slice(0, full.length - 4);
  const checksum = full.slice(full.length - 4);
  const want = hash256(payload).slice(0, 4);
  for (let i = 0; i < 4; i++) {
    if (want[i] !== checksum[i]) throw new Error('base58 checksum mismatch');
  }
  return payload;
}

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_MAP: Record<string, number> = Object.fromEntries(
  BECH32_CHARSET.split('').map((c, i) => [c, i])
) as Record<string, number>;
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values: number[]): number {
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = (((chk & 0x1ff_ffff) << 5) ^ v) >>> 0;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk ^= gen[i]!;
    }
  }
  return chk >>> 0;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const ch of hrp) out.push(ch.charCodeAt(0) >> 5);
  out.push(0);
  for (const ch of hrp) out.push(ch.charCodeAt(0) & 31);
  return out;
}

function bech32VerifyChecksum(hrp: string, data: number[]): 'bech32' | 'bech32m' | null {
  const pm = bech32Polymod([...bech32HrpExpand(hrp), ...data]);
  if (pm === BECH32_CONST) return 'bech32';
  if (pm === BECH32M_CONST) return 'bech32m';
  return null;
}

function bech32Decode(bech: string): { hrp: string; data: number[]; spec: 'bech32' | 'bech32m' } | null {
  let s = (bech || '').trim();
  if (!s) return null;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 33 || code > 126) return null;
  }
  if (s.toLowerCase() !== s && s.toUpperCase() !== s) return null;
  s = s.toLowerCase();
  if (s.length > 90) return null;

  const pos = s.lastIndexOf('1');
  if (pos < 1 || pos + 7 > s.length) return null;

  const hrp = s.slice(0, pos);
  const dataPart = s.slice(pos + 1);
  const data: number[] = [];
  for (const ch of dataPart) {
    const v = BECH32_MAP[ch];
    if (v == null) return null;
    data.push(v);
  }

  const spec = bech32VerifyChecksum(hrp, data);
  if (spec == null) return null;

  return { hrp, data: data.slice(0, -6), spec };
}

function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;
  for (const v of data) {
    if (v < 0 || (v >> fromBits)) return null;
    acc = ((acc << fromBits) | v) & maxAcc;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) ret.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    return null;
  }
  return ret;
}

function decodeSegwitAddress(addr: string): { hrp: string; witver: number; prog: Uint8Array } | null {
  const dec = bech32Decode(addr);
  if (dec == null) return null;
  if (!dec.data.length) return null;

  const witver = dec.data[0]!;
  if (witver > 16) return null;

  const progBytes = convertBits(dec.data.slice(1), 5, 8, false);
  if (progBytes == null) return null;

  const prog = new Uint8Array(progBytes);
  if (prog.length < 2 || prog.length > 40) return null;

  if (witver === 0) {
    if (dec.spec !== 'bech32') return null;
    if (prog.length !== 20 && prog.length !== 32) return null;
  } else {
    if (dec.spec !== 'bech32m') return null;
  }

  return { hrp: dec.hrp, witver, prog };
}

function scriptPubKeyFromAddress(addr: string): Uint8Array {
  const a = (addr || '').trim();
  if (!a) throw new Error('empty address');

  if (a.toLowerCase().startsWith('bc1') || a.toLowerCase().startsWith('tb1') || a.toLowerCase().startsWith('bcrt1')) {
    const dec = decodeSegwitAddress(a);
    if (dec == null) throw new Error('invalid bech32 address');
    const op = dec.witver === 0 ? 0x00 : 0x50 + dec.witver;
    return concatBytes(new Uint8Array([op, dec.prog.length]), dec.prog);
  }

  const payload = base58checkDecode(a);
  if (payload.length !== 21) throw new Error('unexpected base58 payload length');

  const ver = payload[0]!;
  const h20 = payload.slice(1);

  if (ver === 0x00 || ver === 0x6f) {
    return concatBytes(new Uint8Array([0x76, 0xa9, 0x14]), h20, new Uint8Array([0x88, 0xac]));
  }
  if (ver === 0x05 || ver === 0xc4) {
    return concatBytes(new Uint8Array([0xa9, 0x14]), h20, new Uint8Array([0x87]));
  }

  throw new Error(`unsupported address version: 0x${ver.toString(16).padStart(2, '0')}`);
}

function sanitizeSeed(s: string): string {
  let out = (s || '').trim();
  out = out.replace(/\s+/g, ' ');
  out = out.replace(/[^\x00-\x7F]/g, '');
  out = out.replace(/\n/g, ' ').replace(/\r/g, ' ');
  return out.slice(0, 64);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
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
  protected readonly miningMsg = signal('');
  protected readonly targetHex = signal<string | null>(null);
  protected readonly bitsHex = signal<string | null>(null);
  protected readonly results = signal<MineResult[]>([]);

  protected readonly hasAuth = computed(() => !!this.proxyUrl().trim() && !!this.apiKey().trim());

  ngOnInit(): void {
    void (async () => {
      await this.loadRuntimeConfig();
      await this.refreshAll();

      this.blockInterval = window.setInterval(() => void this.fetchBlockInfo(), 30_000);
      this.auxInterval = window.setInterval(() => void this.refreshAux(true), 20_000);
    })();
  }

  ngOnDestroy(): void {
    if (this.blockInterval != null) window.clearInterval(this.blockInterval);
    if (this.auxInterval != null) window.clearInterval(this.auxInterval);
  }

  private async loadRuntimeConfig(): Promise<void> {
    try {
      const r = await fetch('/runtime-config.json', { cache: 'no-store' });
      if (!r.ok) return;
      const cfg = (await r.json()) as RuntimeConfig;
      const bl = cfg?.bitcoinLottery;
      if (!bl) return;

      if (!lsHas('proxyUrl') && typeof bl.proxyUrl === 'string' && bl.proxyUrl.trim()) {
        this.proxyUrl.set(bl.proxyUrl.trim());
      }
      if (!lsHas('apiKey') && typeof bl.apiKey === 'string' && bl.apiKey.trim()) {
        this.apiKey.set(bl.apiKey);
      }
      if (!lsHas('wallet') && typeof bl.wallet === 'string' && bl.wallet.trim()) {
        this.wallet.set(bl.wallet.trim());
      }

      this.persist();
    } catch {
      // ignore
    }
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
      Accept: 'application/json',
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
    this.targetHex.set(null);
    this.bitsHex.set(null);
    this.miningMsg.set('');
  }

  private payoutScriptPubKey(): Uint8Array {
    const hex = (this.scriptPubKeyHex() || '').trim();
    if (hex) return hexToBytes(hex);

    const w = (this.wallet() || '').trim();
    if (w) return scriptPubKeyFromAddress(w);

    throw new Error('Set payout address or scriptPubKey (hex) in Auto-Entry section.');
  }

  protected async mineRealPow(): Promise<void> {
    const b = this.block();
    const height = b?.height;
    const prevHex = (b?.previousblockhash || '').trim();
    const bitsHex = ((b?.next_bits || b?.bits || '') as string).trim().toLowerCase();

    if (!b || typeof height !== 'number' || !prevHex || !bitsHex) {
      this.error.set('No block data yet. Refresh Block Info first.');
      return;
    }

    const bitsNum = Number.parseInt(bitsHex, 16);
    if (!Number.isFinite(bitsNum)) {
      this.error.set('Invalid bits from blockinfo.');
      return;
    }

    this.mining.set(true);
    this.miningMsg.set('');
    this.results.set([]);
    this.error.set('');

    try {
      const target = compactToTarget(bitsHex);
      this.bitsHex.set(bitsHex);
      this.targetHex.set(target.toString(16).padStart(64, '0'));

      const spk = this.payoutScriptPubKey();

      const version = 0x20000000;
      const prevLE = reverseBytes(hexToBytes(prevHex));
      const bitsLE = u32LE(bitsNum);

      const now = Math.floor(Date.now() / 1000);
      let minTime = 0;
      if (typeof b.mediantime === 'number') minTime = Math.max(minTime, b.mediantime + 1);
      if (typeof b.tip_time === 'number') minTime = Math.max(minTime, b.tip_time);
      const ntime = Math.max(now, minTime);

      const enc = new TextEncoder();
      const prefix = enc.encode('bitcoin-lottery').slice(0, 24);

      const rawSeeds = (this.variations().length ? this.variations() : genVars(this.input())).map(sanitizeSeed);
      let seeds = rawSeeds.filter((s) => !!s);
      if (!seeds.length) seeds = [`Block${height}`, todayKey()];
      if (seeds.length > this.maxSeeds()) seeds = seeds.slice(0, this.maxSeeds());

      const attemptsTotal = Math.max(1, Number(this.hashAttempts()) || 1);
      const attemptsPerSeed = Math.max(1, Math.floor(attemptsTotal / Math.max(1, seeds.length)));

      this.miningMsg.set(`Seeds=${seeds.length} attempts_total=${attemptsTotal} per_seed=${attemptsPerSeed}`);

      const out: MineResult[] = [];

      for (let seedIdx = 0; seedIdx < seeds.length; seedIdx++) {
        const seed = seeds[seedIdx]!;
        const seedB = enc.encode(seed);
        const tag = concatBytes(prefix, new Uint8Array([58]), seedB).slice(0, 48);

        const coinbaseTx = buildCoinbaseTx(height, spk, tag);
        const mrklLE = merkleRootLE([hash256(coinbaseTx)]);
        const headerPrefix = concatBytes(u32LE(version), prevLE, mrklLE, u32LE(ntime), bitsLE);

        const nonceStartHash = sha256(enc.encode(seed));
        const nonceStart = readU32LE(nonceStartHash.slice(0, 4));

        let bestVal: bigint | null = null;
        let bestNonce = 0;
        let bestHashLE: Uint8Array = new Uint8Array(32);

        let hitNonce: number | undefined;
        let hitHashLE: Uint8Array | undefined;

        for (let j = 0; j < attemptsPerSeed; j++) {
          if (j % 600 === 0) {
            this.miningMsg.set(`Seed ${seedIdx + 1}/${seeds.length}: ${j}/${attemptsPerSeed} nonces…`);
            await new Promise((r) => window.setTimeout(r, 0));
          }

          const nonce = (nonceStart + j) >>> 0;
          const header = concatBytes(headerPrefix, u32LE(nonce));
          const h = hash256(header);
          const hv = leBytesToBigInt(h);

          if (bestVal == null || hv < bestVal) {
            bestVal = hv;
            bestNonce = nonce;
            bestHashLE = h;
          }

          if (hv <= target) {
            hitNonce = nonce;
            hitHashLE = h;
            break;
          }
        }

        out.push({
          seed,
          attempts: attemptsPerSeed,
          bestNonce,
          bestHash: bytesToHex(reverseBytes(bestHashLE)),
          hit: hitNonce != null,
          hitNonce,
          hitHash: hitHashLE ? bytesToHex(reverseBytes(hitHashLE)) : undefined,
        });

        if (hitNonce != null) break;
      }

      this.results.set(out);
      this.miningMsg.set(out.some((r) => r.hit) ? 'FOUND VALID POW (extremely rare)' : 'Done (no hit)');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.mining.set(false);
    }
  }
}
