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
    slug: 'research-papers',
    title: 'Research Papers',
    summary:
      'AI/Tech/Physics paper digest from curated research feeds, summarized in a random persona with optional TTS narration.',
    sources: ['/api/research-papers/briefing', '/api/research-papers/briefing/refresh', '/api/audio/*']
  },
  {
    slug: 'github-waffle',
    title: 'GitHub Waffle',
    summary: 'Legacy GitHub contribution waffle chart from the Pi2 Angular portal.',
    sources: ['https://ghchart.rshah.org/00ff41/cruzjc', 'https://github.com/cruzjc']
  },
  {
    slug: 'podcast-videos',
    title: 'Podcast Videos',
    summary:
      'Daily curated YouTube playlist from favorite podcast channels (latest first, then random fill to ~1 hour).',
    sources: ['/api/podcast-videos', '/api/podcast-videos/refresh']
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
    slug: 'trading-research',
    title: 'Trading Research',
    summary: 'Pi5-local research runtime + overview top picks + morning scanner results.',
    sources: [
      '/api/trading-research',
      '/api/trading-research/refresh',
      '~/.pi5-dashboard-data/trading/research.json',
      '~/.pi5-dashboard-data/trading/research_journal.json',
      '~/pi5-dashboard-repo/trading-research/enhanced_researcher.py'
    ]
  }
];
