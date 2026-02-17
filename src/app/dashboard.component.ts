import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { Bookmark } from './bookmarks';
import { SECTIONS } from './sections';

const HOME_HIDDEN_SLUGS = new Set(['bitcoin-lottery', 'trading']);

type BookmarkDraft = {
  title: string;
  url: string;
  description: string;
};

type BookmarksResponse = {
  ok?: boolean;
  bookmarks?: Bookmark[];
  updatedAt?: string;
  error?: string;
};

type BookmarksUpdateResponse = {
  ok?: boolean;
  saved?: number;
  updatedAt?: string;
  error?: string;
};

const BOOKMARKS_URL = '/api/bookmarks';
const BOOKMARKS_UPDATE_URL = '/api/bookmarks/update';

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatDateTime(raw: string | null | undefined): string {
  if (!raw) return '-';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  protected readonly sections = SECTIONS.filter((section) => !HOME_HIDDEN_SLUGS.has(section.slug));

  protected readonly bookmarksLoading = signal(false);
  protected readonly bookmarksSaving = signal(false);
  protected readonly bookmarksError = signal('');
  protected readonly bookmarksUpdatedAt = signal('');
  protected readonly bookmarks = signal<Bookmark[]>([]);

  protected readonly editingBookmarks = signal(false);
  protected readonly draftBookmarks = signal<BookmarkDraft[]>([]);

  protected readonly bookmarksUpdatedAtLabel = computed(() => formatDateTime(this.bookmarksUpdatedAt()));

  protected readonly draftSummary = computed(() => {
    const rows = this.draftBookmarks();
    const normalized: Bookmark[] = [];
    let invalidRows = 0;
    let nonBlankRows = 0;

    for (const row of rows) {
      const title = String(row.title || '').trim();
      const url = String(row.url || '').trim();
      const description = String(row.description || '').trim();

      const blank = !title && !url && !description;
      if (blank) continue;

      nonBlankRows += 1;

      if (!title || !url || !isHttpUrl(url)) {
        invalidRows += 1;
        continue;
      }

      const item: Bookmark = { title, url };
      if (description) item.description = description;
      normalized.push(item);
    }

    // Server will reject excessive lists.
    if (nonBlankRows > 200) invalidRows += 1;

    return { normalized, invalidRows, nonBlankRows };
  });

  protected readonly canSaveBookmarks = computed(() => {
    if (!this.editingBookmarks()) return false;
    if (this.bookmarksSaving()) return false;
    return this.draftSummary().invalidRows === 0;
  });

  ngOnInit(): void {
    void this.refreshBookmarks();
  }

  protected refreshBookmarks(): void {
    if (this.editingBookmarks()) return;
    void this.loadBookmarks();
  }

  protected startEditingBookmarks(): void {
    this.bookmarksError.set('');
    const curr = this.bookmarks();
    const draft = curr.map((b) => ({
      title: String(b.title || ''),
      url: String(b.url || ''),
      description: b.description ? String(b.description) : ''
    }));

    if (!draft.length) {
      draft.push({ title: '', url: '', description: '' });
    }

    this.draftBookmarks.set(draft);
    this.editingBookmarks.set(true);
  }

  protected cancelEditingBookmarks(): void {
    if (this.bookmarksSaving()) return;
    this.editingBookmarks.set(false);
    this.draftBookmarks.set([]);
    this.bookmarksError.set('');
  }

  protected addDraftBookmark(): void {
    const curr = this.draftBookmarks();
    this.draftBookmarks.set([...curr, { title: '', url: '', description: '' }]);
  }

  protected removeDraftBookmark(index: number): void {
    const curr = this.draftBookmarks();
    if (index < 0 || index >= curr.length) return;
    const next = curr.slice();
    next.splice(index, 1);
    this.draftBookmarks.set(next.length ? next : [{ title: '', url: '', description: '' }]);
  }

  protected moveDraftBookmark(index: number, delta: -1 | 1): void {
    const curr = this.draftBookmarks();
    const nextIndex = index + delta;
    if (index < 0 || index >= curr.length) return;
    if (nextIndex < 0 || nextIndex >= curr.length) return;

    const next = curr.slice();
    const tmp = next[index]!;
    next[index] = next[nextIndex]!;
    next[nextIndex] = tmp;
    this.draftBookmarks.set(next);
  }

  protected onDraftInput(index: number, field: keyof BookmarkDraft, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;
    const value = target.value ?? '';

    const curr = this.draftBookmarks();
    if (index < 0 || index >= curr.length) return;
    const next = curr.slice();
    const row = next[index]!;
    next[index] = { ...row, [field]: value };
    this.draftBookmarks.set(next);
  }

  protected isDraftRowBlank(row: BookmarkDraft): boolean {
    const title = String(row.title || '').trim();
    const url = String(row.url || '').trim();
    const description = String(row.description || '').trim();
    return !title && !url && !description;
  }

  protected isDraftRowValid(row: BookmarkDraft): boolean {
    if (this.isDraftRowBlank(row)) return true;
    const title = String(row.title || '').trim();
    const url = String(row.url || '').trim();
    if (!title || !url) return false;
    return isHttpUrl(url);
  }

  protected async saveBookmarks(): Promise<void> {
    this.bookmarksError.set('');

    const summary = this.draftSummary();
    if (summary.invalidRows > 0) {
      this.bookmarksError.set('Fix invalid bookmark rows before saving. URLs must start with http:// or https://.');
      return;
    }

    this.bookmarksSaving.set(true);
    try {
      const r = await fetch(BOOKMARKS_UPDATE_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ bookmarks: summary.normalized })
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as BookmarksUpdateResponse;
      if (!data || data.ok !== true) throw new Error(data?.error || 'Save failed');

      this.editingBookmarks.set(false);
      this.draftBookmarks.set([]);
      await this.loadBookmarks();
    } catch (e) {
      this.bookmarksError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.bookmarksSaving.set(false);
    }
  }

  private async loadBookmarks(): Promise<void> {
    this.bookmarksLoading.set(true);
    this.bookmarksError.set('');

    try {
      const r = await fetch(BOOKMARKS_URL, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as BookmarksResponse;
      if (!data || data.ok !== true) throw new Error(data?.error || 'Failed to load bookmarks');

      const list = Array.isArray(data.bookmarks) ? data.bookmarks : [];
      this.bookmarks.set(list);
      this.bookmarksUpdatedAt.set(data.updatedAt ? String(data.updatedAt) : '');
    } catch (e) {
      this.bookmarksError.set(e instanceof Error ? e.message : String(e));
      this.bookmarks.set([]);
      this.bookmarksUpdatedAt.set('');
    } finally {
      this.bookmarksLoading.set(false);
    }
  }
}
