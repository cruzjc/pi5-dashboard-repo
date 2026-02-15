import { Routes } from '@angular/router';

import { OverviewComponent } from './overview.component';
import { SectionComponent } from './section.component';

export const routes: Routes = [
  {
    path: '',
    component: OverviewComponent,
    title: 'Pi5 Dashboard Overview'
  },
  {
    path: 'section/:slug',
    component: SectionComponent,
    title: 'Pi5 Dashboard Section'
  },
  {
    path: '**',
    redirectTo: ''
  }
];
