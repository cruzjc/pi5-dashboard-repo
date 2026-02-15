import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SECTIONS } from './sections';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  protected readonly sections = SECTIONS;
}
