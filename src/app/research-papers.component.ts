import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type AudioEntry = {
  title: string;
  url: string;
  type?: string;
  voice?: string;
};

type ArticleEntry = {
  topic?: string;
  title: string;
  link: string;
  snippet?: string;
  sourceName?: string;
  pubDate?: string;
};

type ResearchPaperBriefing = {
  date?: string;
  period?: string;
  runPolicy?: string;
  nextEligiblePeriod?: string;
  status?: string;
  message?: string;
  geminiConfigured?: boolean;
  startedAt?: string;
  interaction?: { id?: string; agent?: string; status?: string; created?: string; updated?: string };
  configMismatch?: {
    storedTopics?: string[];
    storedTopicsKey?: string;
    currentTopics?: string[];
    currentTopicsKey?: string;
  };
  generatedAt?: string;
  topics?: string[];
  topicsKey?: string;
  modelUsed?: string;
  modelCandidates?: string[];
  persona?: { name?: string; voiceId?: string };
  summaryText?: string;
  narrativeScript?: string;
  audioPlaylist?: AudioEntry[];
  articles?: ArticleEntry[];
  error?: string;
};

const BRIEFING_URL = '/api/research-papers/briefing';
const REFRESH_URL = '/api/research-papers/briefing/refresh';

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
  selector: 'app-research-papers',
  imports: [RouterLink],
  templateUrl: './research-papers.component.html',
  styleUrl: './research-papers.component.scss'
})
export class ResearchPapersComponent implements OnInit {
  protected readonly loading = signal(false);
  protected readonly running = signal(false);
  protected readonly error = signal('');
  protected readonly briefing = signal<ResearchPaperBriefing | null>(null);

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

  protected readonly periodLabel = computed(() => {
    const b = this.briefing();
    const period = b?.period ? String(b.period).trim() : '';
    if (period) return period;
    const date = b?.date ? String(b.date).trim() : '';
    return date || '—';
  });

  protected readonly topicsLabel = computed(() => {
    const topics = this.briefing()?.topics ?? [];
    return topics.length ? topics.join(', ') : '—';
  });

  protected readonly statusLabel = computed(() => {
    const raw = this.briefing()?.status ? String(this.briefing()?.status).trim() : '';
    if (!raw) return '—';
    return raw.replace(/_/g, ' ');
  });

  protected readonly nextEligibleLabel = computed(() => {
    const raw = this.briefing()?.nextEligiblePeriod ? String(this.briefing()?.nextEligiblePeriod).trim() : '';
    return raw || '—';
  });

  protected readonly messageText = computed(() => {
    const raw = this.briefing()?.message ? String(this.briefing()?.message).trim() : '';
    return raw;
  });

  protected readonly modelLabel = computed(() => {
    const used = this.briefing()?.modelUsed;
    if (used && String(used).trim()) return String(used);

    const fallback = this.briefing()?.modelCandidates?.[0];
    return fallback && String(fallback).trim() ? String(fallback) : '—';
  });

  protected readonly runLabel = computed(() => {
    if (this.running()) return 'Running...';

    const status = String(this.briefing()?.status || '').trim();
    if (status === 'not_generated') return 'Run (Monthly)';
    if (status === 'in_progress') return 'Check Status';
    if (status === 'completed') return 'Run Locked';
    if (status === 'failed' || status === 'cancelled') return 'Run Locked';
    return 'Run (Monthly)';
  });

  protected readonly emptySummaryHint = computed(() => {
    const b = this.briefing();
    const status = String(b?.status || '').trim();
    if (status === 'not_generated') return 'Not generated yet for this month. Click Run (Monthly) to start.';
    if (status === 'in_progress') return 'Generation is in progress. Refresh or Check Status to poll.';
    if (b && b.geminiConfigured === false) {
      return 'Set GEMINI_API_KEY on the Config page to enable summarization.';
    }
    return 'No summary available yet.';
  });

  protected readonly groups = computed(() => {
    const arts = this.briefing()?.articles ?? [];
    const configuredTopics = this.briefing()?.topics ?? [];

    const map = new Map<string, ArticleEntry[]>();
    for (const a of arts) {
      const topic = a.topic ? String(a.topic) : 'Other';
      const list = map.get(topic);
      if (list) list.push(a);
      else map.set(topic, [a]);
    }

    const ordered: string[] = [];
    for (const topic of configuredTopics) {
      if (map.has(topic)) ordered.push(topic);
    }

    const rest = Array.from(map.keys()).filter((k) => !ordered.includes(k));
    rest.sort((a, b) => a.localeCompare(b));

    return [...ordered, ...rest].map((topic) => ({ topic, articles: map.get(topic) ?? [] }));
  });

  ngOnInit(): void {
    void this.load(false);
  }

  protected refresh(): void {
    void this.load(false);
  }

  protected run(): void {
    void this.load(true);
  }

  private async load(force: boolean): Promise<void> {
    this.error.set('');
    if (force) this.running.set(true);
    else this.loading.set(true);

    try {
      const r = await fetch(force ? REFRESH_URL : BRIEFING_URL, {
        method: force ? 'POST' : 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as ResearchPaperBriefing;
      if (data && typeof data.error === 'string' && data.error) throw new Error(data.error);
      this.briefing.set(data);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      if (!force) this.briefing.set(null);
    } finally {
      this.loading.set(false);
      this.running.set(false);
    }
  }
}
