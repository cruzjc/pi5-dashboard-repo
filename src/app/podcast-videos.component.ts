import { Component, OnInit, computed, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
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
  protected readonly shuffleEnabled = signal(false);
  protected readonly queue = signal<PlaylistItem[]>([]);
  protected readonly currentVideoId = signal('');

  constructor(private readonly sanitizer: DomSanitizer) {}

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
  protected readonly queueItems = computed(() => this.queue());
  protected readonly currentItem = computed(() => {
    const id = this.currentVideoId();
    return this.queue().find((x) => x.videoId === id) || null;
  });
  protected readonly embedUrl = computed<SafeResourceUrl | null>(() => {
    const queue = this.queue().filter((x) => Boolean(x.videoId));
    if (!queue.length) return null;

    const current = this.currentVideoId() || queue[0]!.videoId || '';
    const ordered = [
      current,
      ...queue
        .map((x) => x.videoId || '')
        .filter((id) => Boolean(id) && id !== current)
    ];

    if (!ordered[0]) return null;

    const first = encodeURIComponent(ordered[0]);
    const rest = ordered.slice(1).map((id) => encodeURIComponent(id)).join(',');
    const base = `https://www.youtube.com/embed/${first}?autoplay=1&rel=0&modestbranding=1`;
    const withPlaylist = rest ? `${base}&playlist=${rest}` : base;
    return this.sanitizer.bypassSecurityTrustResourceUrl(withPlaylist);
  });

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

  protected toggleShuffle(): void {
    this.shuffleEnabled.set(!this.shuffleEnabled());
    this.rebuildQueue(false);
  }

  protected playItem(item: PlaylistItem): void {
    if (!item.videoId) return;
    this.currentVideoId.set(item.videoId);
  }

  protected next(): void {
    const q = this.queue();
    if (!q.length) return;
    const current = this.currentVideoId();
    const idx = q.findIndex((x) => x.videoId === current);
    const nextIdx = idx >= 0 ? (idx + 1) % q.length : 0;
    const id = q[nextIdx]?.videoId || '';
    if (id) this.currentVideoId.set(id);
  }

  protected prev(): void {
    const q = this.queue();
    if (!q.length) return;
    const current = this.currentVideoId();
    const idx = q.findIndex((x) => x.videoId === current);
    const prevIdx = idx >= 0 ? (idx - 1 + q.length) % q.length : 0;
    const id = q[prevIdx]?.videoId || '';
    if (id) this.currentVideoId.set(id);
  }

  protected nowPlayingLabel(): string {
    const current = this.currentItem();
    return current?.title || '—';
  }

  protected isPlaying(item: PlaylistItem): boolean {
    return Boolean(item.videoId) && item.videoId === this.currentVideoId();
  }

  private rebuildQueue(keepCurrent: boolean): void {
    const base = (this.data()?.playlist ?? []).filter((x) => Boolean(x.videoId));
    const currentBefore = this.currentVideoId();

    let nextQueue = base.slice();
    if (this.shuffleEnabled()) {
      nextQueue = this.shuffle(nextQueue);
    }

    this.queue.set(nextQueue);
    if (!nextQueue.length) {
      this.currentVideoId.set('');
      return;
    }

    if (keepCurrent && currentBefore && nextQueue.some((x) => x.videoId === currentBefore)) {
      this.currentVideoId.set(currentBefore);
      return;
    }

    this.currentVideoId.set(nextQueue[0]!.videoId || '');
  }

  private shuffle(items: PlaylistItem[]): PlaylistItem[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = out[i];
      out[i] = out[j]!;
      out[j] = t!;
    }
    return out;
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
      this.rebuildQueue(true);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      if (!force) {
        this.data.set(null);
        this.queue.set([]);
        this.currentVideoId.set('');
      }
    } finally {
      this.loading.set(false);
      this.refreshing.set(false);
    }
  }
}
