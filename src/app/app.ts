import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { SECTIONS } from './sections';

type DailyTheme = {
  id: string;
  label: string;
};

const THEMES: DailyTheme[] = [
  { id: 'oceanic', label: 'Oceanic' },
  { id: 'sandstone', label: 'Sandstone' },
  { id: 'forest', label: 'Forest' },
  { id: 'ember', label: 'Ember' }
];

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function pickThemeForToday(now: Date): DailyTheme {
  const idx = dayOfYear(now) % THEMES.length;
  return THEMES[idx]!;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly sections = SECTIONS;
  protected readonly dailyTheme = pickThemeForToday(new Date());
}
