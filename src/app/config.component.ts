import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type PortalConfigResponse = {
  has?: Record<string, boolean>;
};

type PortalUpdateResponse = {
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

const PI2_PORTAL_API_BASE = '/pi2/portal-api';

const KEY_DEFS: KeyDef[] = [
  {
    key: 'openaiApiKey',
    label: 'OpenAI API Key',
    description: 'Used by portal AI features and trading prompts.',
    placeholder: 'sk-...',
    sensitive: true
  },
  {
    key: 'openaiModel',
    label: 'OpenAI Model',
    description: 'Model name used for OpenAI calls (optional).',
    placeholder: 'gpt-4o-mini'
  },
  {
    key: 'geminiApiKey',
    label: 'Gemini API Key',
    description: 'Used for news summarization and briefings.',
    placeholder: 'AIza...',
    sensitive: true
  },
  {
    key: 'inworldApiKey',
    label: 'Inworld API Key',
    description: 'Optional: used for TTS voice sessions.',
    placeholder: 'inworld_...',
    sensitive: true
  },
  {
    key: 'inworldSecret',
    label: 'Inworld API Secret',
    description: 'Optional: secret used for Inworld TTS.',
    placeholder: '...',
    sensitive: true
  },
  {
    key: 'alpacaKeyId',
    label: 'Alpaca Key ID',
    description: 'Trading account API key id.',
    placeholder: 'PK...',
    sensitive: true
  },
  {
    key: 'alpacaSecretKey',
    label: 'Alpaca Secret Key',
    description: 'Trading account API secret.',
    placeholder: '...',
    sensitive: true
  },
  {
    key: 'alpacaBaseUrl',
    label: 'Alpaca Base URL',
    description: 'Example: https://paper-api.alpaca.markets or https://api.alpaca.markets',
    placeholder: 'https://api.alpaca.markets'
  },
  {
    key: 'ntfyUrl',
    label: 'ntfy URL',
    description: 'Optional: base URL for ntfy notifications.',
    placeholder: 'https://ntfy.sh'
  },
  {
    key: 'ntfyTopic',
    label: 'ntfy Topic',
    description: 'Optional: topic for notifications.',
    placeholder: 'my-topic'
  },
  {
    key: 'newsFeeds',
    label: 'News Feeds',
    description: 'Optional: comma-separated or JSON list of feeds (stored as a string).',
    placeholder: 'https://example.com/rss, https://another.com/rss',
    multiline: true
  }
];

@Component({
  selector: 'app-config',
  imports: [RouterLink],
  templateUrl: './config.component.html',
  styleUrl: './config.component.scss'
})
export class ConfigComponent implements OnInit {
  protected readonly entries = KEY_DEFS;

  protected readonly loading = signal(false);
  protected readonly savingKey = signal<string | null>(null);
  protected readonly error = signal('');

  protected readonly hasMap = signal<Record<string, boolean>>({});
  protected readonly drafts = signal<Record<string, string>>({});
  protected readonly reveals = signal<Record<string, boolean>>({});
  protected readonly updatedAt = signal('');

  protected readonly connected = computed(() =>
    !this.loading() && !this.error() && Object.keys(this.hasMap()).length > 0
  );

  protected readonly statusText = computed(() => {
    if (this.loading()) return 'Loading Pi2 config...';
    if (this.error()) return 'Unavailable';
    const keys = Object.keys(this.hasMap());
    if (!keys.length) return 'Not loaded';
    const configured = Object.values(this.hasMap()).filter(Boolean).length;
    return `Loaded (${configured}/${this.entries.length} configured)`;
  });

  ngOnInit(): void {
    void this.refresh();
  }

  protected has(key: string): boolean {
    return Boolean(this.hasMap()[key]);
  }

  protected draft(key: string): string {
    return this.drafts()[key] ?? '';
  }

  protected setDraft(key: string, value: string): void {
    const curr = this.drafts();
    this.drafts.set({ ...curr, [key]: value });
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

  protected async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');

    try {
      const r = await fetch(`${PI2_PORTAL_API_BASE}/config`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as PortalConfigResponse;
      const has = data?.has && typeof data.has === 'object' ? data.has : {};
      this.hasMap.set(has as Record<string, boolean>);
      this.updatedAt.set(new Date().toLocaleString());
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      this.hasMap.set({});
    } finally {
      this.loading.set(false);
    }
  }

  private async update(set: Record<string, string | null>): Promise<void> {
    const r = await fetch(`${PI2_PORTAL_API_BASE}/config/update`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ set })
    });

    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    const data = (await r.json()) as PortalUpdateResponse;
    if (data && data.ok) return;
    if (data && typeof data.error === 'string' && data.error) throw new Error(data.error);
  }

  protected async setKey(key: string): Promise<void> {
    const value = this.draft(key).trim();
    if (!value) return;

    this.savingKey.set(key);
    this.error.set('');

    try {
      await this.update({ [key]: value });
      const curr = this.drafts();
      const next = { ...curr };
      delete next[key];
      this.drafts.set(next);
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
