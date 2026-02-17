import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type EnvConfigResponse = {
  ok?: boolean;
  values?: Record<string, string>;
  updatedAt?: string;
  envPath?: string;
  error?: string;
};

type EnvUpdateResponse = {
  ok?: boolean;
  changed?: string[];
  error?: string;
};

type KeyDef = {
  key: string;
  label: string;
  description: string;
  placeholder?: string;
  sensitive?: boolean;
  multiline?: boolean;
};

const API_BASE = '/api/config/env';

const KNOWN_KEYS: KeyDef[] = [
  {
    key: 'OPENAI_API_KEY',
    label: 'OpenAI API Key',
    description: 'Used by portal AI features and trading prompts.',
    placeholder: 'sk-...',
    sensitive: true
  },
  {
    key: 'OPENAI_MODEL',
    label: 'OpenAI Model',
    description: 'Model name used for OpenAI calls (optional).',
    placeholder: 'gpt-4o-mini'
  },
  {
    key: 'GEMINI_API_KEY',
    label: 'Gemini API Key',
    description: 'Used for news summarization and briefings.',
    placeholder: 'AIza...',
    sensitive: true
  },
  {
    key: 'INWORLD_API_KEY',
    label: 'Inworld API Key',
    description: 'Optional: used for TTS voice sessions.',
    placeholder: 'inworld_...',
    sensitive: true
  },
  {
    key: 'INWORLD_SECRET',
    label: 'Inworld API Secret',
    description: 'Optional: secret used for Inworld TTS.',
    placeholder: '...',
    sensitive: true
  },
  {
    key: 'ALPACA_API_KEY_ID',
    label: 'Alpaca Key ID',
    description: 'Trading account API key id.',
    placeholder: 'PK...',
    sensitive: true
  },
  {
    key: 'ALPACA_API_SECRET_KEY',
    label: 'Alpaca Secret Key',
    description: 'Trading account API secret.',
    placeholder: '...',
    sensitive: true
  },
  {
    key: 'APCA_API_BASE_URL',
    label: 'Alpaca Base URL',
    description: 'Example: https://paper-api.alpaca.markets or https://api.alpaca.markets',
    placeholder: 'https://api.alpaca.markets'
  },
  {
    key: 'NTFY_URL',
    label: 'ntfy URL',
    description: 'Optional: base URL for ntfy notifications.',
    placeholder: 'https://ntfy.sh'
  },
  {
    key: 'NTFY_TOPIC',
    label: 'ntfy Topic',
    description: 'Optional: topic for notifications.',
    placeholder: 'my-topic'
  },
  {
    key: 'NEWS_FEEDS',
    label: 'News Feeds',
    description: 'Optional: comma-separated or JSON list of feeds (stored as a string).',
    placeholder: 'https://example.com/rss, https://another.com/rss',
    multiline: true
  },
  {
    key: 'GAME_BRIEFING_GAMES',
    label: 'Game Briefing Games',
    description: 'Optional: comma/newline-separated list of games for the Game Briefing page.',
    placeholder: 'Arknights\nGenshin Impact\nHonkai: Star Rail',
    multiline: true
  },
  {
    key: 'RESEARCH_PAPER_TOPICS',
    label: 'Research Paper Topics',
    description: 'Optional: topics to include for Research Papers (AI, Tech, Physics).',
    placeholder: 'AI\nTech\nPhysics',
    multiline: true
  },
  {
    key: 'RESEARCH_PAPER_GEMINI_MODELS',
    label: 'Research Paper Gemini Models',
    description: 'Optional: ordered fallback list for summarization model selection.',
    placeholder: 'gemini-3-deep-think\ngemini-2.5-pro\ngemini-2.0-flash',
    multiline: true
  }
];

function safeReadClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text);
  }

  // Fallback for non-secure contexts (HTTP on LAN).
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
  selector: 'app-config',
  imports: [RouterLink],
  templateUrl: './config.component.html',
  styleUrl: './config.component.scss'
})
export class ConfigComponent implements OnInit {
  protected readonly loading = signal(false);
  protected readonly savingKey = signal<string | null>(null);
  protected readonly error = signal('');

  protected readonly updatedAt = signal('');
  protected readonly envPath = signal('');

  private readonly serverValues = signal<Record<string, string>>({});
  protected readonly drafts = signal<Record<string, string>>({});
  protected readonly reveals = signal<Record<string, boolean>>({});

  protected readonly toast = signal('');

  private readonly knownKeySet = new Set(KNOWN_KEYS.map((k) => k.key));

  protected readonly entries = computed(() => {
    const values = this.serverValues();
    const extra = Object.keys(values)
      .filter((k) => !this.knownKeySet.has(k))
      .sort((a, b) => a.localeCompare(b))
      .map(
        (k): KeyDef => ({
          key: k,
          label: k,
          description: 'Custom env var (stored on Pi5).',
          placeholder: '',
          sensitive: true
        })
      );
    return [...KNOWN_KEYS, ...extra];
  });

  protected readonly connected = computed(() =>
    !this.loading() && !this.error() && Object.keys(this.serverValues()).length > 0
  );

  protected readonly statusText = computed(() => {
    if (this.loading()) return 'Loading Pi5 env...';
    if (this.error()) return 'Unavailable';
    const keys = Object.keys(this.serverValues());
    if (!keys.length) return 'Not loaded';
    const configured = Object.values(this.serverValues()).filter((v) => String(v || '').trim().length > 0)
      .length;
    return `Loaded (${configured}/${keys.length} set)`;
  });

  ngOnInit(): void {
    void this.refresh();
  }

  protected isConfigured(key: string): boolean {
    const v = this.serverValues()[key];
    return typeof v === 'string' && v.trim().length > 0;
  }

  protected draft(key: string): string {
    return this.drafts()[key] ?? '';
  }

  protected setDraft(key: string, value: string): void {
    const curr = this.drafts();
    this.drafts.set({ ...curr, [key]: value });
  }

  protected isDirty(key: string): boolean {
    const server = this.serverValues()[key] ?? '';
    const draft = this.drafts()[key] ?? '';
    return server !== draft;
  }

  protected reveal(key: string): boolean {
    return Boolean(this.reveals()[key]);
  }

  protected toggleReveal(key: string): void {
    const curr = this.reveals();
    this.reveals.set({ ...curr, [key]: !curr[key] });
  }

  protected inputType(key: string, entry: KeyDef): string {
    if (!entry.sensitive) return 'text';
    return this.reveal(key) ? 'text' : 'password';
  }

  protected async copy(key: string): Promise<void> {
    this.toast.set('');
    const v = this.draft(key);
    if (!v) return;

    try {
      await safeReadClipboard(v);
      this.toast.set(`Copied ${key}`);
      window.setTimeout(() => this.toast.set(''), 1500);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');

    try {
      const r = await fetch(API_BASE, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as EnvConfigResponse;
      if (!data || data.ok !== true) {
        throw new Error(data?.error || 'Failed to load env');
      }

      const values = data.values && typeof data.values === 'object' ? data.values : {};
      this.serverValues.set(values);
      this.drafts.set({ ...values });
      this.updatedAt.set(data.updatedAt ? String(data.updatedAt) : new Date().toISOString());
      this.envPath.set(data.envPath ? String(data.envPath) : '');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      this.serverValues.set({});
      this.drafts.set({});
    } finally {
      this.loading.set(false);
    }
  }

  private async update(set: Record<string, string | null>): Promise<void> {
    const r = await fetch(`${API_BASE}/update`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ set })
    });

    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as EnvUpdateResponse;
    if (data && data.ok) return;
    if (data && typeof data.error === 'string' && data.error) throw new Error(data.error);
    throw new Error('Update failed');
  }

  protected async setKey(key: string): Promise<void> {
    const value = this.draft(key);
    if (!value.trim()) return;

    this.savingKey.set(key);
    this.error.set('');

    try {
      await this.update({ [key]: value });
      await this.refresh();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.savingKey.set(null);
    }
  }

  protected async clearKey(key: string): Promise<void> {
    this.savingKey.set(key);
    this.error.set('');

    try {
      await this.update({ [key]: null });
      await this.refresh();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.savingKey.set(null);
    }
  }
}
