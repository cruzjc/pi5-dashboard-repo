import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SECTIONS } from './sections';

@Component({
  selector: 'app-overview',
  imports: [RouterLink],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.scss'
})
export class OverviewComponent {
  protected readonly sections = SECTIONS;
}
