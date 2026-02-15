import { Routes } from '@angular/router';

import { BitcoinLotteryComponent } from './bitcoin-lottery.component';
import { ConfigComponent } from './config.component';
import { DashboardComponent } from './dashboard.component';
import { SectionComponent } from './section.component';
import { TodoComponent } from './todo.component';
import { TradingComponent } from './trading.component';

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
    path: 'config',
    component: ConfigComponent,
    title: 'Configuration'
  },
  {
    path: 'section/bitcoin-lottery',
    component: BitcoinLotteryComponent,
    title: 'Bitcoin Lottery'
  },
  {
    path: 'section/trading',
    component: TradingComponent,
    title: 'Trading'
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
