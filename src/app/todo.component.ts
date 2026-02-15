import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SECTIONS } from './sections';

const STORAGE_KEY = 'pi5-dashboard.todo.v1';

function safeRead(): Record<string, boolean> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(obj)) out[String(k)] = Boolean(v);
    return out;
  } catch {
    return {};
  }
}

function safeWrite(state: Record<string, boolean>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

@Component({
  selector: 'app-todo',
  imports: [RouterLink],
  templateUrl: './todo.component.html',
  styleUrl: './todo.component.scss'
})
export class TodoComponent {
  protected readonly sections = SECTIONS;

  protected readonly doneBySlug = signal<Record<string, boolean>>(safeRead());

  protected readonly doneCount = computed(() =>
    this.sections.reduce((n, s) => n + (this.doneBySlug()[s.slug] ? 1 : 0), 0)
  );

  protected readonly totalCount = computed(() => this.sections.length);

  protected readonly pct = computed(() => {
    const total = this.totalCount();
    return total === 0 ? 0 : Math.round((this.doneCount() / total) * 100);
  });

  protected isDone(slug: string): boolean {
    return Boolean(this.doneBySlug()[slug]);
  }

  protected toggle(slug: string): void {
    const curr = this.doneBySlug();
    const next = { ...curr, [slug]: !curr[slug] };
    this.doneBySlug.set(next);
    safeWrite(next);
  }

  protected reset(): void {
    const next: Record<string, boolean> = {};
    this.doneBySlug.set(next);
    safeWrite(next);
  }
}
