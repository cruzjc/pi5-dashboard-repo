import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type TradingPosition = {
  symbol: string;
  qty: number;
  current_price: number;
  avg_entry_price: number;
  unrealized_pl: number;
  unrealized_plpc: number;
};

type TradingStatus = {
  botRunning?: boolean;
  cash?: number;
  equity?: number;
  dayPL?: number;
  positions?: TradingPosition[];
  lastUpdate?: string;
  error?: string;
};

type StrategyEntry = {
  name: string;
  kind: 'systemd' | 'cron' | 'job';
  timing: string;
  schedule: string[];
  details: string[];
  notes?: string;
};

const PI2_TRADING_STATUS_URL = '/pi2/api/trading/status';

const STRATEGIES: StrategyEntry[] = [
  {
    name: 'alpaca-trader',
    kind: 'systemd',
    timing: 'Always-on service',
    schedule: [],
    details: [
      'systemd: alpaca-trader.service (Pi2)',
      'exec: ~/projects/trader/.venv/bin/python ~/projects/trader/alpaca_ai_trader.py --config ~/projects/trader/config.yaml',
      'env: ~/.trader-config.env',
      'flags: alpaca_paper=false, live_trading=true, dry_run=false',
      'logs: ~/projects/trader/bot.log',
      'state: ~/projects/trader/state.json'
    ],
    notes: 'Configured for live trading per config.yaml.'
  },
  {
    name: 'qqq0dte',
    kind: 'systemd',
    timing: 'Always-on service',
    schedule: [],
    details: [
      'systemd: qqq0dte.service (Pi2)',
      'exec: ~/projects/0DTE-QQQ-Calls/venv/bin/python -u src/main.py',
      'env: ~/projects/0DTE-QQQ-Calls/.env',
      'paper: ALPACA_PAPER=true',
      'loop: CHECK_INTERVAL_SECONDS=300',
      'entry: ENTRY_WINDOW_MINUTES=60',
      'limits: MAX_TRADES_PER_DAY=1, MAX_DAILY_LOSS_USD=100'
    ],
    notes: 'Paper trading per .env.'
  },
  {
    name: 'aggressive_call_momentum_V1',
    kind: 'cron',
    timing: 'Weekdays: open at 09:32 ET; manage every 10 minutes',
    schedule: [
      'open: 32 3 * * 1-5 (EDT) / 32 4 * * 1-5 (EST) [DST-gated]',
      'manage: */10 * * * 1-5'
    ],
    details: [
      'script: ~/projects/trading-system/Strategies/aggressive_call_momentum_V1/cron_aggressive_call_momentum_V1_open.cron.sh',
      'script: ~/projects/trading-system/Strategies/aggressive_call_momentum_V1/cron_aggressive_call_momentum_V1_manage.cron.sh',
      'logs: ~/projects/trading-system/Strategies/aggressive_call_momentum_V1/job_block.log',
      'logs: ~/projects/trading-system/Strategies/aggressive_call_momentum_V1/manage_job.log'
    ]
  },
  {
    name: 'tqqq_sqqq_daily_V3',
    kind: 'cron',
    timing: 'Weekdays: open at 09:25 ET; manage every 10 minutes',
    schedule: [
      'open: 25 3 * * 1-5 (EDT) / 25 4 * * 1-5 (EST) [DST-gated]',
      'manage: */10 * * * 1-5'
    ],
    details: [
      'script: ~/projects/trading-system/Strategies/tqqq_sqqq_daily_V3/cron_tqqq_sqqq_daily_V3_open.cron.sh',
      'script: ~/projects/trading-system/Strategies/tqqq_sqqq_daily_V3/cron_tqqq_sqqq_daily_V3_manage.cron.sh',
      'env: ~/projects/trading-system/.env (APCA_API_BASE_URL, ALPACA_ENABLE_TRADING, TQQQ_SQQQ_V3_LIVE)',
      'logs: ~/projects/trading-system/Strategies/tqqq_sqqq_daily_V3/job_block.log',
      'logs: ~/projects/trading-system/Strategies/tqqq_sqqq_daily_V3/manage_job.log'
    ],
    notes: 'Live gating is controlled inside the strategy + env flags.'
  },
  {
    name: 'robinhood-researcher',
    kind: 'job',
    timing: 'Daily at 19:00 (cron)',
    schedule: ['0 19 * * *'],
    details: [
      'cwd: ~/robinhood-researcher',
      'run: python enhanced_researcher.py',
      'output: ~/altportal/api/research.json'
    ]
  }
];

@Component({
  selector: 'app-trading',
  imports: [RouterLink],
  templateUrl: './trading.component.html',
  styleUrl: './trading.component.scss'
})
export class TradingComponent implements OnInit, OnDestroy {
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly status = signal<TradingStatus | null>(null);

  protected readonly strategies = STRATEGIES;

  private refreshTimer: number | null = null;

  protected readonly positions = computed(() => this.status()?.positions ?? []);

  protected readonly lastUpdateLabel = computed(() => {
    const raw = this.status()?.lastUpdate;
    if (!raw) return '—';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString();
  });

  ngOnInit(): void {
    void this.refresh(false);
    this.refreshTimer = window.setInterval(() => void this.refresh(true), 30_000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer != null) window.clearInterval(this.refreshTimer);
  }

  protected money(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return `$${value.toFixed(2)}`;
  }

  protected signedMoney(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    const sign = value > 0 ? '+' : '';
    return `${sign}$${value.toFixed(2)}`;
  }

  protected async refresh(silent: boolean): Promise<void> {
    if (!silent) this.loading.set(true);
    this.error.set('');

    try {
      const r = await fetch(PI2_TRADING_STATUS_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as TradingStatus;
      if (data && typeof data.error === 'string' && data.error) {
        throw new Error(data.error);
      }
      this.status.set(data);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      if (!silent) this.status.set(null);
    } finally {
      if (!silent) this.loading.set(false);
    }
  }
}
