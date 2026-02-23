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
    slug: 'codex-cli',
    title: 'ChatGPT Codex CLI',
    summary:
      'Interactive browser terminal for Codex CLI with browser auth, persona composer, and narrated CLI summaries.',
    sources: [
      '/api/ai-cli/session/codex',
      '/api/ai-cli/session/codex/start',
      '/api/ai-cli/session/codex/persona/send',
      '/api/ai-cli/ws?provider=codex&channel=main'
    ]
  },
  {
    slug: 'claude-cli',
    title: 'Claude Code CLI',
    summary:
      'Interactive browser terminal for Claude Code with browser auth, persona composer, and narrated CLI summaries.',
    sources: [
      '/api/ai-cli/session/claude',
      '/api/ai-cli/session/claude/start',
      '/api/ai-cli/session/claude/persona/send',
      '/api/ai-cli/ws?provider=claude&channel=main'
    ]
  },
  {
    slug: 'gemini-cli',
    title: 'Gemini Code CLI',
    summary:
      'Interactive browser terminal for Gemini Code CLI with YOLO-mode sessions, persona composer, and narrated summaries.',
    sources: [
      '/api/ai-cli/session/gemini',
      '/api/ai-cli/session/gemini/start',
      '/api/ai-cli/session/gemini/persona/send',
      '/api/ai-cli/ws?provider=gemini&channel=main'
    ]
  },
  {
    slug: 'harness-engineering',
    title: 'Harness Engineering',
    summary:
      'Agent-first Codex harness workflow with dashboard-managed worktrees, generated task artifacts, parallel subtasks, browser validation, and auto commit/push.',
    sources: [
      '/api/harness/config',
      '/api/harness/runs',
      '/api/harness/ws?runId=<id>&channel=orchestrator',
      '/api/ai-cli/session/codex-harness'
    ]
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
    summary: 'Pi3-local Alpaca account snapshot plus local strategy inventory (systemd + cron).',
    sources: ['/api/trading/status', '/api/trading-research']
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
