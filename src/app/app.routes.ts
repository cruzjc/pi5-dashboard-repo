import { Routes } from '@angular/router';

import { BitcoinLotteryComponent } from './bitcoin-lottery.component';
import { ConfigComponent } from './config.component';
import { DashboardComponent } from './dashboard.component';
import { NewsSummaryComponent } from './news-summary.component';
import { GameBriefingComponent } from './game-briefing.component';
import { GithubWaffleComponent } from './github-waffle.component';
import { PodcastVideosComponent } from './podcast-videos.component';
import { SectionComponent } from './section.component';
import { TodoComponent } from './todo.component';
import { TradingComponent } from './trading.component';
import { TradingResearchComponent } from './trading-research.component';

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
    path: 'section/news-summary',
    component: NewsSummaryComponent,
    title: 'News Summary'
  },
  {
    path: 'section/game-briefing',
    component: GameBriefingComponent,
    title: 'Game Briefing'
  },
  {
    path: 'section/github-waffle',
    component: GithubWaffleComponent,
    title: 'GitHub Waffle'
  },
  {
    path: 'section/podcast-videos',
    component: PodcastVideosComponent,
    title: 'Podcast Videos'
  },
  {
    path: 'section/trading',
    component: TradingComponent,
    title: 'Trading'
  },
  {
    path: 'section/trading-research',
    component: TradingResearchComponent,
    title: 'Trading Research'
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
