import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type AudioEntry = {
  title: string;
  url: string;
  type?: string;
  voice?: string;
};

type ArticleEntry = {
  title: string;
  link: string;
  snippet?: string;
  sourceName?: string;
  category?: string;
  pubDate?: string;
};

type NewsBriefing = {
  date?: string;
  generatedAt?: string;
  persona?: { name?: string; voiceId?: string };
  summaryText?: string;
  narrativeScript?: string;
  audioPlaylist?: AudioEntry[];
  articles?: ArticleEntry[];
  error?: string;
};

const NEWS_URL = '/api/news';
const REFRESH_URL = '/api/news/refresh';

function splitBullets(text: string | null | undefined): string[] {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 1 && !lines[0]!.startsWith('-') && !lines[0]!.startsWith('*')) return lines;

  return lines
    .map((l) => l.replace(/^[*-]\s+/, '').trim())
    .filter(Boolean);
}

function formatDateTime(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

@Component({
  selector: 'app-news-summary',
  imports: [RouterLink],
  templateUrl: './news-summary.component.html',
  styleUrl: './news-summary.component.scss'
})
export class NewsSummaryComponent implements OnInit {
  protected readonly loading = signal(false);
  protected readonly regenerating = signal(false);
  protected readonly error = signal('');
  protected readonly briefing = signal<NewsBriefing | null>(null);

  protected readonly bulletLines = computed(() => splitBullets(this.briefing()?.summaryText));

  protected readonly audioUrl = computed(() => this.briefing()?.audioPlaylist?.[0]?.url ?? '');
  protected readonly hasAudio = computed(() => Boolean(this.audioUrl()));

  protected readonly personaLabel = computed(() => {
    const p = this.briefing()?.persona;
    const name = p?.name ? String(p.name) : 'Unknown';
    const voice = p?.voiceId ? String(p.voiceId) : '';
    return voice ? `${name} (${voice})` : name;
  });

  protected readonly generatedAtLabel = computed(() => formatDateTime(this.briefing()?.generatedAt));

  protected readonly groups = computed(() => {
    const arts = this.briefing()?.articles ?? [];
    const map = new Map<string, ArticleEntry[]>();

    for (const a of arts) {
      const cat = a.category ? String(a.category) : 'Other';
      const list = map.get(cat);
      if (list) list.push(a);
      else map.set(cat, [a]);
    }

    return Array.from(map.entries()).map(([category, articles]) => ({ category, articles }));
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

  private async load(force: boolean): Promise<void> {
    this.error.set('');
    if (force) this.regenerating.set(true);
    else this.loading.set(true);

    try {
      const r = await fetch(force ? REFRESH_URL : NEWS_URL, {
        method: force ? 'POST' : 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as NewsBriefing;
      if (data && typeof data.error === 'string' && data.error) throw new Error(data.error);
      this.briefing.set(data);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      if (!force) this.briefing.set(null);
    } finally {
      this.loading.set(false);
      this.regenerating.set(false);
    }
  }
}
