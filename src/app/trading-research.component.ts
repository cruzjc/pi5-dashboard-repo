import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type ScannerCandidate = {
  ticker?: string;
  score?: number;
  dir?: string;
  close?: number;
  roc3?: number;
  volSurge?: number;
  rs5d?: number;
};

type Sentiment = {
  score?: number;
  summary?: string;
};

type SuggestedOption = {
  strike?: number;
  premium?: number;
  break_even?: number;
  iv?: number;
  oi?: number;
  volume?: number;
};

type EntryExit = {
  stock_entry?: number;
  stock_target?: number;
  stock_stop?: number;
};

type TradeIdea = {
  direction?: string;
  bias?: string;
  expiry?: string;
  reasons?: string[];
  entry_exit?: EntryExit;
  suggested_option?: SuggestedOption;
};

type ResearchPick = {
  ticker?: string;
  price?: number;
  score?: number;
  reasons?: string[];
  change_pct?: number;
  momentum_5d?: number;
  vol_surge?: number;
  rsi?: number;
  support?: number;
  resistance?: number;
  earnings_date?: string;
  days_to_earnings?: number;
  options?: {
    iv_avg?: number;
    expected_move_pct?: number;
  };
  ai_sentiment?: Sentiment;
  trade_idea?: TradeIdea;
};

type EarningsCalendarDay = {
  day?: string;
  date?: string;
  is_today?: boolean;
  earnings?: Array<{ ticker?: string }>;
};

type ResearchData = {
  generated_at?: string;
  next_update?: string;
  config?: {
    max_stock_price?: number;
    max_option_premium?: number;
    min_score?: number;
  };
  summary?: {
    opportunities_found?: number;
    earnings_upcoming?: number;
    total_scanned?: number;
    passed_filters?: number;
    oversold_count?: number;
  };
  top_picks?: ResearchPick[];
  earnings_calendar?: EarningsCalendarDay[];
  categories?: {
    earnings_plays?: ResearchPick[];
    momentum_plays?: ResearchPick[];
    oversold_plays?: ResearchPick[];
  };
};

type JournalEntry = {
  created_at?: string;
  title?: string;
  summary?: string;
  model?: string;
  top_picks?: Array<{ ticker?: string }>;
  ai_journal?: {
    headline?: string;
    notes?: string;
    tone?: string;
    themes?: string[];
    watchlist?: Array<{ ticker?: string; direction?: string; why?: string }>;
  };
};

type TradingResearchSnapshot = {
  generatedAt?: string;
  sourceBaseUrl?: string;
  research?: ResearchData | null;
  journalEntries?: JournalEntry[];
  overviewTopPicks?: ResearchPick[];
  scannerCandidates?: ScannerCandidate[];
  account?: {
    cash?: number | null;
    equity?: number | null;
    buyingPower?: number | null;
    openPositions?: number | null;
    openOrders?: number | null;
  };
  strategyStatus?: Record<string, string>;
  openclaw?: {
    pcOnline?: boolean | null;
    nextWake?: string;
    updatedAt?: string;
  };
  errors?: Record<string, string>;
  error?: string;
};

const SNAPSHOT_URL = '/api/trading-research';
const REFRESH_URL = '/api/trading-research/refresh';

function formatDateTime(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

@Component({
  selector: 'app-trading-research',
  imports: [RouterLink],
  templateUrl: './trading-research.component.html',
  styleUrl: './trading-research.component.scss'
})
export class TradingResearchComponent implements OnInit {
  protected readonly loading = signal(false);
  protected readonly refreshing = signal(false);
  protected readonly error = signal('');
  protected readonly snapshot = signal<TradingResearchSnapshot | null>(null);

  protected readonly research = computed(() => this.snapshot()?.research ?? null);
  protected readonly overviewPicks = computed(() => this.snapshot()?.overviewTopPicks ?? []);
  protected readonly scannerRows = computed(() => this.snapshot()?.scannerCandidates ?? []);

  protected readonly topPicksDetailed = computed(() => (this.research()?.top_picks ?? []).slice(0, 5));
  protected readonly calendarDays = computed(() => this.research()?.earnings_calendar ?? []);

  protected readonly earningsPlays = computed(() => this.research()?.categories?.earnings_plays ?? []);
  protected readonly momentumPlays = computed(() => this.research()?.categories?.momentum_plays ?? []);
  protected readonly oversoldPlays = computed(() => this.research()?.categories?.oversold_plays ?? []);

  protected readonly journalEntries = computed(() => this.snapshot()?.journalEntries ?? []);

  protected readonly generatedAtLabel = computed(() => formatDateTime(this.snapshot()?.generatedAt));
  protected readonly scanAtLabel = computed(() => formatDateTime(this.research()?.generated_at));
  protected readonly openclawAtLabel = computed(() => formatDateTime(this.snapshot()?.openclaw?.updatedAt));

  protected readonly loadWarnings = computed(() => {
    const errors = this.snapshot()?.errors ?? {};
    return Object.entries(errors)
      .filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
      .map(([k, v]) => `${k}: ${v}`);
  });

  protected readonly strategyRows = computed(() => {
    const map = this.snapshot()?.strategyStatus ?? {};
    return Object.entries(map).map(([name, status]) => ({ name, status })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  });

  ngOnInit(): void {
    void this.load(false);
  }

  protected refresh(): void {
    void this.load(false);
  }

  protected forceRefresh(): void {
    void this.load(true);
  }

  protected money(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return `$${Number(value).toFixed(2)}`;
  }

  protected percent(value: number | null | undefined, digits = 1): string {
    if (value == null || !Number.isFinite(value)) return '—';
    const n = Number(value);
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toFixed(digits)}%`;
  }

  protected scoreClass(score: number | null | undefined): string {
    if (score == null || !Number.isFinite(score)) return 'neutral';
    if (score >= 6) return 'bull';
    if (score >= 4) return 'call';
    return 'neutral';
  }

  protected directionClass(value: string | null | undefined): string {
    const raw = String(value || '')
      .trim()
      .toLowerCase();

    if (raw.includes('bull') || raw === 'call') return 'bull';
    if (raw.includes('bear') || raw === 'put') return 'bear';
    return 'neutral';
  }

  protected strategyClass(value: string | null | undefined): string {
    const raw = String(value || '')
      .trim()
      .toLowerCase();
    if (['enabled', 'active', 'online', 'running'].includes(raw)) return 'success';
    if (['disabled', 'inactive', 'stopped', 'sleeping', 'unknown'].includes(raw)) return 'warning';
    return 'accent';
  }

  protected toneClass(value: string | null | undefined): string {
    const raw = String(value || '')
      .trim()
      .toLowerCase();
    if (raw === 'bullish') return 'bull';
    if (raw === 'bearish') return 'bear';
    return 'neutral';
  }

  private async load(force: boolean): Promise<void> {
    this.error.set('');
    if (force) this.refreshing.set(true);
    else this.loading.set(true);

    try {
      const r = await fetch(force ? REFRESH_URL : SNAPSHOT_URL, {
        method: force ? 'POST' : 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as TradingResearchSnapshot;
      if (data && typeof data.error === 'string' && data.error) throw new Error(data.error);
      this.snapshot.set(data);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      if (!force) this.snapshot.set(null);
    } finally {
      this.loading.set(false);
      this.refreshing.set(false);
    }
  }
}
