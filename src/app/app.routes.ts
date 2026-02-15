import { Routes } from '@angular/router';

import { DashboardComponent } from './dashboard.component';
import { SectionComponent } from './section.component';
import { TodoComponent } from './todo.component';

export const routes: Routes = [
  {
    path: '',
    component: DashboardComponent,
    title: 'Pi5 Dashboard'
  },
  {
    path: 'todo',
    component: TodoComponent,
    title: 'Migration Todo'
  },
  {
    path: 'section/:slug',
    component: SectionComponent,
    title: 'Section Plan'
  },
  {
    path: '**',
    redirectTo: ''
  }
];
