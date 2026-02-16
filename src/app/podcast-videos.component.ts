import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type PlaylistItem = {
  sourceId?: string;
  sourceName?: string;
  mode?: string;
  title?: string;
  link?: string;
  videoId?: string;
  publishedAt?: string;
  isShort?: boolean;
  estimatedSeconds?: number;
  pickReason?: 'recent' | 'fill-random' | string;
};

type SourceMeta = {
  id?: string;
  name?: string;
  mode?: string;
  count?: number;
};

type PodcastPlaylist = {
  date?: string;
  generatedAt?: string;
  targetSeconds?: number;
  targetMinutes?: number;
  totalSeconds?: number;
  totalMinutes?: number;
  recentCutoffHours?: number;
  exceededTargetWithRecent?: boolean;
  sourceMeta?: SourceMeta[];
  playlist?: PlaylistItem[];
  errors?: Record<string, string>;
  error?: string;
};

const PLAYLIST_URL = '/api/podcast-videos';
const REFRESH_URL = '/api/podcast-videos/refresh';

function fmtDateTime(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

function fmtMinutes(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  return `${Math.round(Number(sec) / 60)} min`;
}

@Component({
  selector: 'app-podcast-videos',
  imports: [RouterLink],
  templateUrl: './podcast-videos.component.html',
  styleUrl: './podcast-videos.component.scss'
})
export class PodcastVideosComponent implements OnInit {
  protected readonly loading = signal(false);
  protected readonly refreshing = signal(false);
  protected readonly error = signal('');
  protected readonly data = signal<PodcastPlaylist | null>(null);

  protected readonly generatedAt = computed(() => fmtDateTime(this.data()?.generatedAt));
  protected readonly totalLabel = computed(() => fmtMinutes(this.data()?.totalSeconds));
  protected readonly targetLabel = computed(() => fmtMinutes(this.data()?.targetSeconds));

  protected readonly recentCount = computed(
    () => (this.data()?.playlist ?? []).filter((x) => x.pickReason === 'recent').length
  );
  protected readonly randomCount = computed(
    () => (this.data()?.playlist ?? []).filter((x) => x.pickReason === 'fill-random').length
  );

  protected readonly items = computed(() => this.data()?.playlist ?? []);

  protected readonly warnings = computed(() => {
    const errs = this.data()?.errors ?? {};
    return Object.entries(errs).map(([k, v]) => `${k}: ${v}`);
  });

  ngOnInit(): void {
    void this.load(false);
  }

  protected refresh(): void {
    void this.load(false);
  }

  protected regenerate(): void {
    void this.load(true);
  }

  protected itemMinutes(item: PlaylistItem): string {
    return fmtMinutes(item.estimatedSeconds);
  }

  protected reasonLabel(item: PlaylistItem): string {
    if (item.pickReason === 'recent') return 'Latest';
    if (item.pickReason === 'fill-random') return 'Random Fill';
    return item.pickReason || '—';
  }

  private async load(force: boolean): Promise<void> {
    this.error.set('');
    if (force) this.refreshing.set(true);
    else this.loading.set(true);

    try {
      const r = await fetch(force ? REFRESH_URL : PLAYLIST_URL, {
        method: force ? 'POST' : 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as PodcastPlaylist;
      if (body && typeof body.error === 'string' && body.error) throw new Error(body.error);
      this.data.set(body);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      if (!force) this.data.set(null);
    } finally {
      this.loading.set(false);
      this.refreshing.set(false);
    }
  }
}
