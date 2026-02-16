export type LegacySection = {
  slug: string;
  title: string;
  summary: string;
  sources: string[];
};

export const SECTIONS: LegacySection[] = [
  {
    slug: 'news-summary',
    title: 'News Summary',
    summary: 'AI Briefing: hard-coded RSS sources, persona summary, optional TTS narration.',
    sources: ['/api/news', '/api/news/refresh', '/api/audio/*']
  },
  {
    slug: 'game-briefing',
    title: 'Game Briefing',
    summary: 'Game events and updates: per-game RSS, persona summary, optional TTS narration.',
    sources: ['/api/games/briefing', '/api/games/briefing/refresh', '/api/audio/*']
  },
  {
    slug: 'angular-portal',
    title: 'Angular Portal Core',
    summary: 'Primary Angular portal currently served at / and :3000 on Pi 2.',
    sources: ['http://192.168.4.12/', 'http://192.168.4.12:3000/']
  },
  {
    slug: 'alt-openclaw-portal',
    title: 'Alt OpenClaw Portal',
    summary: 'Legacy static portal currently at /alt on Pi 2.',
    sources: ['http://192.168.4.12/alt']
  },
  {
    slug: 'openclaw-status',
    title: 'OpenClaw Status',
    summary: 'Status interface and API for OpenClaw health information.',
    sources: ['http://192.168.4.12/openclaw', 'http://192.168.4.12/api/openclaw/status']
  },
  {
    slug: 'bitcoin-lottery',
    title: 'Bitcoin Lottery',
    summary: 'Lottery UI with proxy-backed API calls.',
    sources: ['http://192.168.4.12/bitcoin-lottery.html', 'http://192.168.4.12/bitcoin/*']
  },
  {
    slug: 'trading',
    title: 'Trading',
    summary: 'Alpaca account snapshot plus Pi2 strategy inventory (systemd + cron).',
    sources: ['http://192.168.4.12/api/trading/status', 'http://portal.pi2/ui/trading.html']
  },
  {
    slug: 'portal-dashboard-pages',
    title: 'Portal Dashboard Legacy Pages',
    summary: 'Legacy dashboard and /ui pages under portal.pi2 host routing.',
    sources: [
      'http://portal.pi2/dashboard',
      'http://portal.pi2/ui/briefing.html',
      'http://portal.pi2/ui/github.html',
      'http://portal.pi2/ui/manage.html',
      'http://portal.pi2/ui/settings.html',
      'http://portal.pi2/ui/trading.html',
      'http://portal.pi2/ui/voices.html'
    ]
  },
  {
    slug: 'task-queue',
    title: 'Task Queue',
    summary: 'Queue workflows and wake coordination API currently proxied under /queue/*.',
    sources: ['http://192.168.4.12/queue/api/health', 'http://192.168.4.12/queue/api/tasks']
  }
];
