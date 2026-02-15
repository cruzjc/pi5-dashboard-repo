import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SECTIONS } from './sections';

const HOME_HIDDEN_SLUGS = new Set(['bitcoin-lottery', 'trading']);

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  protected readonly sections = SECTIONS.filter((section) => !HOME_HIDDEN_SLUGS.has(section.slug));
}
