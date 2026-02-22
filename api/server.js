#!/usr/bin/env node

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createAiCliFeature } = require('./ai-cli');

const HOST = process.env.PI5_DASHBOARD_API_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PI5_DASHBOARD_API_PORT || '8092', 10);
const ENV_PATH =
  process.env.PI5_DASHBOARD_ENV_PATH || path.join(os.homedir(), '.pi5-dashboard.keys.env');

const DATA_DIR =
  process.env.PI5_DASHBOARD_DATA_DIR || path.join(os.homedir(), '.pi5-dashboard-data');
const BRIEFINGS_DIR = path.join(DATA_DIR, 'briefings');
const GAME_BRIEFINGS_DIR = path.join(DATA_DIR, 'game-briefings');
const RESEARCH_PAPER_BRIEFINGS_DIR = path.join(DATA_DIR, 'research-paper-briefings');
const PODCAST_VIDEOS_DIR = path.join(DATA_DIR, 'podcast-videos');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const BOOKMARKS_FILE =
  process.env.PI5_DASHBOARD_BOOKMARKS_FILE || path.join(DATA_DIR, 'bookmarks.json');

const CATEGORY_PRIORITIES = [
  'Breaking News',
  'AI',
  'Tech',
  'Local',
  'World',
  'Business',
  'Science',
  'Finance',
  'Politics',
  'Health'
];

const NEWS_SOURCES = [
  // Breaking
  {
    id: 'BN1',
    name: 'AP Breaking News',
    url: 'https://apnews.com/rss/topnews',
    category: 'Breaking News',
    enabled: true
  },
  {
    id: 'BN2',
    name: 'Reuters Top News',
    url: 'https://www.reutersagency.com/feed/?best-topics=top-news&post_type=best',
    category: 'Breaking News',
    enabled: true
  },
  {
    id: 'BN3',
    name: 'BBC Breaking',
    url: 'https://feeds.bbci.co.uk/news/rss.xml',
    category: 'Breaking News',
    enabled: true
  },
  {
    id: 'BN4',
    name: 'NPR Breaking',
    url: 'https://feeds.npr.org/1001/rss.xml',
    category: 'Breaking News',
    enabled: true
  },
  {
    id: 'BN5',
    name: 'Google News Top',
    url: 'https://news.google.com/rss',
    category: 'Breaking News',
    enabled: true
  },

  // Local (HI)
  {
    id: 'L1',
    name: 'Honolulu Star-Advertiser',
    url: 'https://www.staradvertiser.com/feed/',
    category: 'Local',
    enabled: true
  },
  { id: 'L2', name: 'KITV', url: 'https://www.kitv.com/feed/', category: 'Local', enabled: true },
  {
    id: 'L3',
    name: 'Hawaii News Now',
    url: 'https://www.hawaiinewsnow.com/rss/',
    category: 'Local',
    enabled: true
  },
  {
    id: 'L4',
    name: 'Hawaii Public Radio',
    url: 'https://www.hawaiipublicradio.org/rss/',
    category: 'Local',
    enabled: true
  },
  { id: 'L5', name: 'Maui Now', url: 'https://mauinow.com/feed/', category: 'Local', enabled: true },

  // World
  {
    id: 'W1',
    name: 'BBC World',
    url: 'http://feeds.bbci.co.uk/news/world/rss.xml',
    category: 'World',
    enabled: true
  },
  {
    id: 'W2',
    name: 'Reuters World',
    url: 'https://www.reutersagency.com/feed/?best-topics=world-news',
    category: 'World',
    enabled: true
  },
  {
    id: 'W3',
    name: 'Al Jazeera',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    category: 'World',
    enabled: true
  },
  {
    id: 'W4',
    name: 'The Guardian World',
    url: 'https://www.theguardian.com/world/rss',
    category: 'World',
    enabled: true
  },
  {
    id: 'W5',
    name: 'DW News',
    url: 'https://rss.dw.com/rdf/rss-en-all',
    category: 'World',
    enabled: true
  },

  // Tech
  {
    id: 'T1',
    name: 'Hacker News',
    url: 'https://news.ycombinator.com/rss',
    category: 'Tech',
    enabled: true
  },
  {
    id: 'T2',
    name: 'The Verge',
    url: 'https://www.theverge.com/rss/index.xml',
    category: 'Tech',
    enabled: true
  },
  {
    id: 'T3',
    name: 'TechCrunch',
    url: 'https://techcrunch.com/feed/',
    category: 'Tech',
    enabled: true
  },
  {
    id: 'T4',
    name: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    category: 'Tech',
    enabled: true
  },
  {
    id: 'T5',
    name: 'The Register',
    url: 'https://www.theregister.com/headlines.atom',
    category: 'Tech',
    enabled: true
  },

  // AI
  { id: 'A1', name: 'OpenAI Blog', url: 'https://openai.com/blog/rss.xml', category: 'AI', enabled: true },
  {
    id: 'A2',
    name: 'Google AI Blog',
    url: 'https://blog.google/technology/ai/rss/',
    category: 'AI',
    enabled: true
  },
  { id: 'A3', name: 'Anthropic', url: 'https://www.anthropic.com/feed', category: 'AI', enabled: true },
  {
    id: 'A4',
    name: 'Hugging Face Blog',
    url: 'https://huggingface.co/blog/feed.xml',
    category: 'AI',
    enabled: true
  },
  { id: 'A5', name: 'MIT Tech Review AI', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', category: 'AI', enabled: true },

  // Finance
  {
    id: 'F1',
    name: 'CNBC Markets',
    url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    category: 'Finance',
    enabled: true
  },
  {
    id: 'F2',
    name: 'Yahoo Finance',
    url: 'https://finance.yahoo.com/rss/',
    category: 'Finance',
    enabled: true
  },
  {
    id: 'F3',
    name: 'MarketWatch Top Stories',
    url: 'https://feeds.marketwatch.com/marketwatch/topstories/',
    category: 'Finance',
    enabled: true
  },
  {
    id: 'F4',
    name: 'Investopedia',
    url: 'https://www.investopedia.com/feedbuilder/feed/getfeed?feedName=rss_headline',
    category: 'Finance',
    enabled: true
  },

  // Science
  {
    id: 'S1',
    name: 'NASA Breaking News',
    url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss',
    category: 'Science',
    enabled: true
  },
  { id: 'S2', name: 'Nature', url: 'https://www.nature.com/nature.rss', category: 'Science', enabled: true },
  {
    id: 'S3',
    name: 'Science Daily',
    url: 'https://www.sciencedaily.com/rss/all.xml',
    category: 'Science',
    enabled: true
  },
  { id: 'S4', name: 'Phys.org', url: 'https://phys.org/rss-feed/', category: 'Science', enabled: true },
  {
    id: 'S5',
    name: 'Scientific American',
    url: 'https://www.scientificamerican.com/feed/',
    category: 'Science',
    enabled: true
  }
];

const DEFAULT_PERSONAS = [
  // Ported from Pi2 portal personalities.
  {
    name: 'Bagpipe',
    voiceId: 'default-w5tqexcshinf-_u9dgvlow__bagpipe',
    personality:
      'You are Bagpipe. You are grounded, earnest, and upbeat with a no-nonsense tone. Present the news clearly with practical takeaways. Avoid sensationalism.'
  },
  {
    name: 'Lappland',
    voiceId: 'default-w5tqexcshinf-_u9dgvlow__lappland_the_decadenza',
    personality:
      'You are Lappland. You are mischievous, dramatic, and fast, but never inaccurate. Present the news with punchy phrasing and sharp commentary, then return to clarity.'
  },
  {
    name: 'Aglaea',
    voiceId: 'default-w5tqexcshinf-_u9dgvlow__aglaea',
    personality:
      'You are Aglaea, the Dressmaster of Okhema and Chrysos Heir of Amphoreus. You are assertive, calculating, and duty-bound. Your manner is elegant yet commanding. You speak with sharp insight and absolute conviction. Present the news with graceful authority, as one who perceives all lies with perfect clarity.'
  }
];

const DEFAULT_GAMES = ['Arknights'];
const MAX_GAMES = 12;
const GAME_SOURCE_ITEM_LIMIT = 8;
const GENERIC_SOURCE_ITEM_LIMIT = 25;
const MAX_ARTICLES_PER_GAME = 14;
const DEFAULT_RESEARCH_TOPICS = ['AI', 'Tech', 'Physics'];
const RESEARCH_PAPER_ITEM_LIMIT_PER_SOURCE = 8;
const MAX_RESEARCH_ARTICLES = 60;
const RESEARCH_PAPER_TOPIC_PRIORITIES = ['AI', 'Tech', 'Physics'];
const DEFAULT_RESEARCH_GEMINI_MODELS = ['gemini-3-deep-think', 'gemini-2.5-pro', 'gemini-2.0-flash'];
const RESEARCH_PAPER_INTERACTION_AGENT = String(
  process.env.RESEARCH_PAPER_INTERACTION_AGENT || 'deep-research-pro-preview-12-2025'
).trim();

const GAME_REDDIT_SUBREDDITS = {
  Arknights: 'arknights',
  'Genshin Impact': 'Genshin_Impact',
  'Honkai: Star Rail': 'HonkaiStarRail',
  'Honkai Star Rail': 'HonkaiStarRail',
  'Zenless Zone Zero': 'ZenlessZoneZero',
  'Wuthering Waves': 'WutheringWaves',
  'Blue Archive': 'BlueArchive',
  'Fate/Grand Order': 'grandorder',
  'Azur Lane': 'AzureLane',
  'Epic Seven': 'EpicSeven',
  'Goddess of Victory: Nikke': 'NikkeMobile',
  NIKKE: 'NikkeMobile'
};

const GENERIC_GAME_SOURCES = [
  {
    id: 'GG1',
    name: 'r/gachagaming',
    url: 'https://www.reddit.com/r/gachagaming/.rss',
    enabled: true
  },
  {
    id: 'GG2',
    name: 'Gematsu',
    url: 'https://www.gematsu.com/feed',
    enabled: true
  }
];

const RESEARCH_PAPER_SOURCES = [
  {
    id: 'RP1',
    name: 'arXiv Computer Science (AI)',
    url: 'https://export.arxiv.org/rss/cs.AI',
    topic: 'AI',
    enabled: true
  },
  {
    id: 'RP2',
    name: 'arXiv Machine Learning',
    url: 'https://export.arxiv.org/rss/cs.LG',
    topic: 'AI',
    enabled: true
  },
  {
    id: 'RP3',
    name: 'arXiv Computation and Language',
    url: 'https://export.arxiv.org/rss/cs.CL',
    topic: 'AI',
    enabled: true
  },
  {
    id: 'RP4',
    name: 'arXiv Computer Science',
    url: 'https://export.arxiv.org/rss/cs',
    topic: 'Tech',
    enabled: true
  },
  {
    id: 'RP5',
    name: 'arXiv Information Theory',
    url: 'https://export.arxiv.org/rss/cs.IT',
    topic: 'Tech',
    enabled: true
  },
  {
    id: 'RP6',
    name: 'arXiv Quantum Physics',
    url: 'https://export.arxiv.org/rss/quant-ph',
    topic: 'Physics',
    enabled: true
  },
  {
    id: 'RP7',
    name: 'arXiv Astrophysics',
    url: 'https://export.arxiv.org/rss/astro-ph',
    topic: 'Physics',
    enabled: true
  },
  {
    id: 'RP8',
    name: 'arXiv High Energy Physics',
    url: 'https://export.arxiv.org/rss/hep-ph',
    topic: 'Physics',
    enabled: true
  }
];

const PODCAST_VIDEO_TARGET_SECONDS = Number.parseInt(
  process.env.PODCAST_VIDEO_TARGET_SECONDS || '3600',
  10
);
const PODCAST_VIDEO_RECENT_HOURS = Number.parseInt(process.env.PODCAST_VIDEO_RECENT_HOURS || '30', 10);

const PODCAST_VIDEO_SOURCES = [
  {
    id: 'P1',
    name: 'StarTalk (Shorts)',
    mode: 'shorts',
    channelUrl: 'https://www.youtube.com/@StarTalk'
  },
  {
    id: 'P2',
    name: 'TechLinked (Videos)',
    mode: 'videos',
    channelUrl: 'https://www.youtube.com/@techlinked'
  },
  {
    id: 'P3',
    name: 'Linus Tech Tips (Shorts)',
    mode: 'shorts',
    channelUrl: 'https://www.youtube.com/@LinusTechTips'
  },
  {
    id: 'P4',
    name: 'David Bombal (Shorts)',
    mode: 'shorts',
    channelUrl: 'https://www.youtube.com/@davidbombal'
  }
];


const PI2_ALT_BASE_URL = String(process.env.PI2_ALT_BASE_URL || 'http://192.168.4.12/alt').replace(
  /\/+$/,
  ''
);
const TRADING_RESEARCH_CACHE_MS = Number.parseInt(
  process.env.TRADING_RESEARCH_CACHE_MS || '60000',
  10
);
const TRADING_RESEARCH_LOCAL_ONLY = String(process.env.TRADING_RESEARCH_LOCAL_ONLY || '1') !== '0';
const TRADING_RESEARCH_LOCAL_STALE_MS = Number.parseInt(
  process.env.TRADING_RESEARCH_LOCAL_STALE_MS || '21600000',
  10
);
const TRADING_RESEARCH_RUN_TIMEOUT_MS = Number.parseInt(
  process.env.TRADING_RESEARCH_RUN_TIMEOUT_MS || '300000',
  10
);
const TRADING_RESEARCH_DATA_DIR =
  process.env.TRADING_RESEARCH_DATA_DIR || path.join(DATA_DIR, 'trading');
const TRADING_RESEARCH_OUTPUT_FILE =
  process.env.TRADING_RESEARCH_OUTPUT_FILE || path.join(TRADING_RESEARCH_DATA_DIR, 'research.json');
const TRADING_RESEARCH_JOURNAL_FILE =
  process.env.TRADING_RESEARCH_JOURNAL_FILE ||
  path.join(TRADING_RESEARCH_DATA_DIR, 'research_journal.json');
const TRADING_RESEARCH_SCRIPT =
  process.env.TRADING_RESEARCH_SCRIPT ||
  path.join(os.homedir(), 'pi5-dashboard-repo', 'trading-research', 'enhanced_researcher.py');
const TRADING_RESEARCH_LOG_FILE =
  process.env.TRADING_RESEARCH_LOG_FILE ||
  path.join(TRADING_RESEARCH_DATA_DIR, 'research-agent-on-demand.log');
const DEFAULT_TRADING_RESEARCH_PYTHON = path.join(
  os.homedir(),
  'pi5-dashboard-repo',
  '.venv-trading-research',
  'bin',
  'python3'
);
const TRADING_RESEARCH_PYTHON =
  process.env.TRADING_RESEARCH_PYTHON ||
  (fs.existsSync(DEFAULT_TRADING_RESEARCH_PYTHON) ? DEFAULT_TRADING_RESEARCH_PYTHON : 'python3');

const USER_AGENT = 'pi5-dashboard/1.0 (+local LAN)';

function nowIso() {
  return new Date().toISOString();
}

function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function localMonthString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function ensureDir(dir, mode = 0o700) {
  fs.mkdirSync(dir, { recursive: true, mode });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req, limitBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limitBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isValidKeyName(name) {
  return /^[A-Z_][A-Z0-9_]*$/.test(name);
}

function decodeShellValue(raw) {
  // Accept: VALUE, 'VALUE', "VALUE".
  const v = raw.trim();
  if (!v) return '';
  if (v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1);
  }
  if (v.startsWith('"') && v.endsWith('"')) {
    const inner = v.slice(1, -1);
    return inner
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return v;
}

function encodeShellValue(value) {
  // Single-quote for safe `source` usage. Escape single quotes via: 'foo'\''bar'
  const s = String(value);
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function parseEnvFile(text) {
  const out = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;
    if (raw.startsWith('#')) continue;

    const m = raw.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;

    const key = m[1];
    let value = m[2] ?? '';
    // Strip inline comments only when unquoted.
    if (!(value.startsWith("'") || value.startsWith('"'))) {
      const hash = value.indexOf('#');
      if (hash !== -1) value = value.slice(0, hash);
    }

    out[key] = decodeShellValue(value);
  }
  return out;
}

function readEnvMap() {
  try {
    const raw = fs.readFileSync(ENV_PATH, 'utf8');
    return parseEnvFile(raw);
  } catch (e) {
    if (e && e.code === 'ENOENT') return {};
    throw e;
  }
}

function writeEnvMapAtomic(map) {
  const dir = path.dirname(ENV_PATH);
  ensureDir(dir, 0o700);

  const keys = Object.keys(map).sort((a, b) => a.localeCompare(b));
  const lines = [];
  lines.push(`# Generated by pi5-dashboard-api at ${nowIso()}`);
  lines.push('# Contains secrets. Keep this file private.');
  for (const k of keys) {
    const v = map[k];
    if (v == null) continue;
    const vv = String(v);
    if (!vv) continue;
    lines.push(`export ${k}=${encodeShellValue(vv)}`);
  }
  const body = lines.join('\n') + '\n';

  const tmp = `${ENV_PATH}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, ENV_PATH);
  fs.chmodSync(ENV_PATH, 0o600);
}

function jsonError(res, code, msg) {
  sendJson(res, code, { ok: false, error: msg });
}

function normalizeBookmarkEntry(raw) {
  if (!raw || typeof raw !== 'object') return { blank: false, ok: false, bookmark: null };

  const title = String(raw.title || '').trim();
  const url = String(raw.url || '').trim();
  const description = String(raw.description || '').trim();

  const blank = !title && !url && !description;
  if (blank) return { blank: true, ok: true, bookmark: null };

  if (!title || !url) return { blank: false, ok: false, bookmark: null };

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { blank: false, ok: false, bookmark: null };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { blank: false, ok: false, bookmark: null };
  }

  const out = {
    title: title.slice(0, 120),
    url: parsed.toString().slice(0, 2048)
  };
  if (description) out.description = description.slice(0, 240);

  return { blank: false, ok: true, bookmark: out };
}

function normalizeBookmarksPayload(raw) {
  const list =
    Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray(raw.bookmarks) ? raw.bookmarks : null;
  if (!list) return { ok: false, error: 'missing bookmarks list', bookmarks: [], invalidRows: 0 };

  const out = [];
  let invalidRows = 0;

  for (const item of list) {
    const r = normalizeBookmarkEntry(item);
    if (r.blank) continue;
    if (!r.ok || !r.bookmark) {
      invalidRows += 1;
      continue;
    }
    if (out.length >= 200) {
      invalidRows += 1;
      break;
    }
    out.push(r.bookmark);
  }

  return { ok: invalidRows === 0, error: invalidRows ? 'invalid bookmarks' : '', bookmarks: out, invalidRows };
}

function readBookmarksFromDisk() {
  try {
    const raw = fs.readFileSync(BOOKMARKS_FILE, 'utf8');
    const text = String(raw || '').trim();
    if (!text) return { bookmarks: [], updatedAt: '' };

    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      return { bookmarks: [], updatedAt: '' };
    }

    let updatedAt =
      data && typeof data === 'object' && typeof data.updatedAt === 'string' ? String(data.updatedAt) : '';

    if (!updatedAt) {
      try {
        updatedAt = fs.statSync(BOOKMARKS_FILE).mtime.toISOString();
      } catch {
        updatedAt = '';
      }
    }

    const normalized = normalizeBookmarksPayload(data);
    return { bookmarks: normalized.bookmarks, updatedAt };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { bookmarks: [], updatedAt: '' };
    throw e;
  }
}

function writeBookmarksAtomic(bookmarks) {
  const dir = path.dirname(BOOKMARKS_FILE);
  ensureDir(dir, 0o700);

  const payload = { updatedAt: nowIso(), bookmarks };
  const body = JSON.stringify(payload, null, 2) + '\n';

  const tmp = `${BOOKMARKS_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, BOOKMARKS_FILE);
  fs.chmodSync(BOOKMARKS_FILE, 0o600);
}

function decodeHtmlEntities(s) {
  let t = String(s || '');

  for (let i = 0; i < 2; i++) {
    const prev = t;

    t = t
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_m, n) => {
        const code = Number.parseInt(n, 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
        try {
          return String.fromCodePoint(code);
        } catch {
          return '';
        }
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => {
        const code = Number.parseInt(n, 16);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
        try {
          return String.fromCodePoint(code);
        } catch {
          return '';
        }
      });

    if (t === prev) break;
  }

  return t;
}

function stripHtml(s) {
  let t = decodeHtmlEntities(s);

  t = t
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ');

  t = decodeHtmlEntities(t);
  return t.replace(/\s+/g, ' ').trim();
}

function decodeCdata(s) {
  return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function getTag(xml, tag) {
  const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = r.exec(xml);
  return m ? decodeCdata(m[1]) : '';
}

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemContent = match[1];

    const title = stripHtml(getTag(itemContent, 'title'));
    const link = decodeCdata(getTag(itemContent, 'link'));
    const descRaw = getTag(itemContent, 'description') || getTag(itemContent, 'content:encoded');
    const snippet = stripHtml(descRaw).slice(0, 500);
    const pubDate = stripHtml(getTag(itemContent, 'pubDate'));

    const enclosureMatch =
      /<enclosure[^>]*url=["']([^"']*)[^>]*type=["']([^"']*)/i.exec(itemContent);

    items.push({
      title,
      link,
      contentSnippet: snippet,
      pubDate,
      enclosure: enclosureMatch ? { url: enclosureMatch[1], type: enclosureMatch[2] } : undefined
    });
  }

  return items;
}

function parseAtomEntries(xml) {
  const items = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];
    const title = stripHtml(getTag(entry, 'title'));

    // Atom uses <link href="..."/>
    let link = '';
    const linkMatch = /<link[^>]*href=["']([^"']+)["'][^>]*\/?>(?:<\/link>)?/i.exec(entry);
    if (linkMatch) link = linkMatch[1];

    const summaryRaw = getTag(entry, 'summary') || getTag(entry, 'content');
    const snippet = stripHtml(summaryRaw).slice(0, 500);
    const pubDate = stripHtml(getTag(entry, 'updated') || getTag(entry, 'published'));

    if (title || link) {
      items.push({ title, link, contentSnippet: snippet, pubDate, enclosure: undefined });
    }
  }

  return items;
}

async function fetchAndParseFeed(url) {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const xml = await r.text();

    const rss = parseRssItems(xml);
    if (rss.length) return rss;

    const atom = parseAtomEntries(xml);
    return atom;
  } catch {
    return [];
  }
}

function chooseRandom(arr) {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

async function mapLimit(items, limit, fn) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    executing.add(p);

    const cleanup = () => executing.delete(p);
    p.then(cleanup, cleanup);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

function parseStringList(raw) {
  const t = String(raw || '').trim();
  if (!t) return [];

  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) {
        return arr
          .map((v) => String(v == null ? '' : v).trim())
          .filter(Boolean);
      }
    } catch {
      // fall through
    }
  }

  return t
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function stableListKey(list) {
  const items = list
    .map((s) => String(s || '').trim().toLowerCase())
    .filter(Boolean)
    .sort();

  const out = [];
  for (const s of items) {
    if (!out.length || out[out.length - 1] !== s) out.push(s);
  }
  return out.join('|');
}

function makeSeededRandom(seed) {
  let h = 2166136261;
  const txt = String(seed || 'seed');
  for (let i = 0; i < txt.length; i++) {
    h ^= txt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithRandom(list, rand) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

function parseYouTubeVideoId(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''));
    if (u.hostname === 'youtu.be') {
      return u.pathname.replace(/^\/+/, '').split('/')[0] || '';
    }
    if (u.pathname.startsWith('/watch')) {
      return u.searchParams.get('v') || '';
    }
    if (u.pathname.startsWith('/shorts/')) {
      return u.pathname.split('/')[2] || '';
    }
  } catch {
    return '';
  }
  return '';
}

function podcastVideosPath(date) {
  return path.join(PODCAST_VIDEOS_DIR, `${date}.json`);
}

function readPodcastVideos(date) {
  const file = podcastVideosPath(date);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writePodcastVideosAtomic(date, obj) {
  ensureDir(PODCAST_VIDEOS_DIR, 0o700);
  const file = podcastVideosPath(date);
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

function estimateVideoSeconds(item, source) {
  if (item.isShort) return 60;
  if (String(source?.name || '').toLowerCase().includes('techlinked')) return 600;
  return 540;
}

function detectShortFromMeta(item) {
  const text = `${item.title || ''} ${item.contentSnippet || ''}`.toLowerCase();
  if (text.includes('#shorts')) return true;
  if (text.includes(' youtube shorts')) return true;
  if (String(item.link || '').includes('/shorts/')) return true;
  return false;
}

async function resolveYouTubeFeedUrl(channelUrl) {
  const u = String(channelUrl || '').trim();
  if (!u) throw new Error('missing channel url');

  const direct = u.match(/channel\/(UC[a-zA-Z0-9_-]+)/);
  if (direct && direct[1]) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${direct[1]}`;
  }

  const r = await fetch(u, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml'
    }
  });
  if (!r.ok) throw new Error(`channel page HTTP ${r.status}`);
  const html = await r.text();

  const patterns = [
    /"externalId":"(UC[a-zA-Z0-9_-]+)"/,
    /"channelId":"(UC[a-zA-Z0-9_-]+)"/,
    /feeds\/videos\.xml\?channel_id=(UC[a-zA-Z0-9_-]+)/,
    /channel\/(UC[a-zA-Z0-9_-]+)/
  ];

  for (const p of patterns) {
    const m = p.exec(html);
    if (m && m[1]) {
      return `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`;
    }
  }

  throw new Error('could not resolve channel id');
}

function briefingPath(date) {
  return path.join(BRIEFINGS_DIR, `${date}.json`);
}

function readBriefing(date) {
  const file = briefingPath(date);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeBriefingAtomic(date, obj) {
  ensureDir(BRIEFINGS_DIR, 0o700);
  const file = briefingPath(date);
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

function gameBriefingPath(date) {
  return path.join(GAME_BRIEFINGS_DIR, `${date}.json`);
}

function readGameBriefing(date) {
  const file = gameBriefingPath(date);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeGameBriefingAtomic(date, obj) {
  ensureDir(GAME_BRIEFINGS_DIR, 0o700);
  const file = gameBriefingPath(date);
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

function normalizeMonthPeriod(raw) {
  const t = String(raw || '').trim();
  if (!/^\d{4}-\d{2}$/.test(t)) return '';
  const mm = Number.parseInt(t.slice(5, 7), 10);
  if (!Number.isFinite(mm) || mm < 1 || mm > 12) return '';
  return t;
}

function addMonths(period, count) {
  const p = normalizeMonthPeriod(period);
  if (!p) return '';
  const y = Number.parseInt(p.slice(0, 4), 10);
  const m = Number.parseInt(p.slice(5, 7), 10);
  const d = new Date(Date.UTC(y, m - 1 + count, 1, 0, 0, 0));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

function researchPaperBriefingPath(period) {
  const p = normalizeMonthPeriod(period);
  if (!p) return '';
  return path.join(RESEARCH_PAPER_BRIEFINGS_DIR, `${p}.json`);
}

function readResearchPaperBriefing(period) {
  const file = researchPaperBriefingPath(period);
  if (!file) return null;
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeResearchPaperBriefingAtomic(period, obj) {
  ensureDir(RESEARCH_PAPER_BRIEFINGS_DIR, 0o700);
  const file = researchPaperBriefingPath(period);
  if (!file) throw new Error('invalid period');
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

function trimModelName(raw) {
  return String(raw || '').trim();
}

async function callGeminiModel(geminiApiKey, model, prompt) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(trimModelName(model))}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    })
  });

  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Gemini HTTP ${r.status}: ${t.slice(0, 120)}`);
  }

  const data = await r.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callGemini(geminiApiKey, prompt) {
  return callGeminiModel(geminiApiKey, 'gemini-2.0-flash', prompt);
}

async function callGeminiInteractions(geminiApiKey, method, pathname, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta${pathname}`;

  const r = await fetch(url, {
    method,
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-goog-api-key': geminiApiKey
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await r.text().catch(() => '');
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!r.ok) {
    const msg =
      (data && typeof data === 'object' && data.error && data.error.message) ||
      (data && typeof data === 'object' && data.message) ||
      text.slice(0, 180) ||
      `HTTP ${r.status}`;
    throw new Error(`Gemini Interactions HTTP ${r.status}: ${msg}`);
  }

  return data;
}

async function createGeminiAgentInteraction(geminiApiKey, agent, input) {
  const body = {
    agent,
    input,
    background: true,
    store: true
  };

  return callGeminiInteractions(geminiApiKey, 'POST', '/interactions', body);
}

async function getGeminiInteraction(geminiApiKey, id) {
  const safe = String(id || '').trim();
  if (!safe) throw new Error('missing interaction id');
  return callGeminiInteractions(geminiApiKey, 'GET', `/interactions/${encodeURIComponent(safe)}`);
}

function interactionTextFromOutputs(outputs) {
  if (!Array.isArray(outputs)) return '';
  return outputs
    .filter((o) => o && typeof o === 'object' && o.type === 'text' && typeof o.text === 'string')
    .map((o) => o.text)
    .join('\n')
    .trim();
}

function normalizeTopicName(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  const lower = t.toLowerCase();
  if (lower === 'ai' || lower === 'ml' || lower === 'machine learning') return 'AI';
  if (lower === 'tech' || lower === 'technology') return 'Tech';
  if (lower === 'physics' || lower === 'phys') return 'Physics';
  return t;
}

function readResearchPaperTopics(env) {
  const configured = parseStringList(env.RESEARCH_PAPER_TOPICS);
  const desired = configured.length ? configured : DEFAULT_RESEARCH_TOPICS;
  const out = [];
  const seen = new Set();

  for (const item of desired) {
    const topic = normalizeTopicName(item);
    const key = topic.toLowerCase();
    if (!topic || seen.has(key)) continue;
    seen.add(key);
    out.push(topic);
  }

  return out.length ? out : DEFAULT_RESEARCH_TOPICS.slice();
}

function readResearchPaperGeminiModels(env) {
  const raw = parseStringList(env.RESEARCH_PAPER_GEMINI_MODELS || env.RESEARCH_PAPER_GEMINI_MODEL);
  const merged = [...raw, ...DEFAULT_RESEARCH_GEMINI_MODELS];
  const out = [];
  const seen = new Set();

  for (const model of merged) {
    const trimmed = trimModelName(model);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }

  return out.length ? out : DEFAULT_RESEARCH_GEMINI_MODELS.slice();
}

function cleanModelText(raw) {
  let t = String(raw || '').trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }
  return t.trim();
}

function parseBriefingJson(raw) {
  const t = cleanModelText(raw);
  if (!t) return null;

  try {
    return JSON.parse(t);
  } catch {
    // try extracting first {...last}
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a !== -1 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}


function parseBriefingSections(raw) {
  const t = cleanModelText(raw);
  if (!t) return null;

  const lines = t.split(/\r?\n/);
  let mode = 'none';
  const bullets = [];
  const script = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^BULLETS\s*:/i.test(trimmed)) {
      mode = 'bullets';
      continue;
    }

    if (/^SCRIPT\s*:/i.test(trimmed)) {
      mode = 'script';
      continue;
    }

    if (mode === 'bullets') bullets.push(line);
    else if (mode === 'script') script.push(line);
  }

  const bulletPoints = bullets.join('\n').trim();
  const narrativeScript = script.join('\n').trim();

  if (!bulletPoints && !narrativeScript) return null;
  return { bulletPoints, narrativeScript };
}

async function generateInworldAudio(inworldApiKey, inworldSecret, voiceId, text, filenamePrefix = 'news-summary') {
  const url = 'https://api.inworld.ai/tts/v1/voice';
  const credentials = Buffer.from(`${inworldApiKey}:${inworldSecret}`).toString('base64');

  const MAX_CHUNK = 1800;
  const chunks = [];
  let remaining = String(text || '').trim();

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK) {
      chunks.push(remaining);
      break;
    }

    let splitPoint = MAX_CHUNK;
    const lastPeriod = remaining.lastIndexOf('.', MAX_CHUNK);
    const lastExclaim = remaining.lastIndexOf('!', MAX_CHUNK);
    const lastQuestion = remaining.lastIndexOf('?', MAX_CHUNK);
    const bestSentenceEnd = Math.max(lastPeriod, lastExclaim, lastQuestion);

    if (bestSentenceEnd > MAX_CHUNK * 0.5) {
      splitPoint = bestSentenceEnd + 1;
    }

    chunks.push(remaining.substring(0, splitPoint).trim());
    remaining = remaining.substring(splitPoint).trim();
  }

  const audioBuffers = [];

  for (const chunk of chunks) {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: chunk,
        voiceId,
        modelId: 'inworld-tts-1'
      })
    });

    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`Inworld HTTP ${r.status}: ${t.slice(0, 120)}`);
    }

    const data = await r.json();
    const audioContent = data?.audioContent;
    if (!audioContent) throw new Error('Inworld response missing audioContent');
    audioBuffers.push(Buffer.from(audioContent, 'base64'));
  }

  const combined = Buffer.concat(audioBuffers);
  ensureDir(AUDIO_DIR, 0o700);

  const base = String(filenamePrefix || 'audio')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'audio';

  const filename = `${base}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.mp3`;
  const file = path.join(AUDIO_DIR, filename);
  fs.writeFileSync(file, combined, { mode: 0o600 });
  fs.chmodSync(file, 0o600);

  return { filename, url: `/api/audio/${filename}`, voiceId };
}

function safeAudioNameFromPath(p) {
  const name = String(p || '').split('/').pop() || '';
  if (!name) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  if (!name.toLowerCase().endsWith('.mp3')) return null;
  return name;
}

function serveAudio(res, name) {
  const file = path.join(AUDIO_DIR, name);
  if (!file.startsWith(AUDIO_DIR + path.sep)) {
    jsonError(res, 400, 'invalid path');
    return;
  }
  if (!fs.existsSync(file)) {
    jsonError(res, 404, 'not found');
    return;
  }

  const stat = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-store',
    'Content-Length': stat.size
  });

  fs.createReadStream(file).pipe(res);
}

const inFlightByDate = new Map();
const inFlightGameByKey = new Map();
const inFlightResearchPaperByKey = new Map();
const inFlightTradingResearchByMode = new Map();
const inFlightPodcastByDate = new Map();
let inFlightTradingResearchRun = null;

let tradingResearchCache = { at: 0, payload: null };

async function generateDailyBriefing(force) {
  const date = localDateString();

  if (!force) {
    const existing = readBriefing(date);
    if (existing) return existing;
  }

  const env = readEnvMap();

  const sources = NEWS_SOURCES.filter((s) => s.enabled);
  const results = await mapLimit(sources, 8, async (source) => {
    const items = await fetchAndParseFeed(source.url);
    return { source, items };
  });

  const articles = [];

  for (const { source, items } of results) {
    for (const item of items.slice(0, 2)) {
      articles.push({
        title: item.title || '',
        link: item.link || '',
        snippet: item.contentSnippet || '',
        sourceName: source.name,
        category: source.category,
        pubDate: item.pubDate || ''
      });
    }
  }

  articles.sort((a, b) => {
    const pa = CATEGORY_PRIORITIES.indexOf(a.category);
    const pb = CATEGORY_PRIORITIES.indexOf(b.category);
    const oa = pa === -1 ? 999 : pa;
    const ob = pb === -1 ? 999 : pb;
    return oa - ob;
  });

  const persona = chooseRandom(DEFAULT_PERSONAS) || DEFAULT_PERSONAS[0];

  let summaryText = 'No summary generated.';
  let narrativeScript = '';

  const geminiApiKey = env.GEMINI_API_KEY;
  if (geminiApiKey && articles.length >= 3) {
    try {
      const personalityInstruction = persona?.personality
        ? `PERSONALITY: ${persona.personality}\n\nPresent the news in this character\'s style and voice.\n\n`
        : '';

      const prompt = `${personalityInstruction}You are a news anchor. Create a comprehensive daily briefing from the following headlines.

IMPORTANT:
- Cover ALL major headlines.
- The script should be 2-3 minutes when read aloud (about 300-500 words).
- Do not use markdown.

Return exactly this format:

BULLETS:
- Category: headline summary
- Category: another headline summary
SCRIPT:
A complete narrative script in the persona's voice.

Headlines (sorted by priority):
${articles
        .slice(0, 40)
        .map((a) => `[${a.category}] ${a.title}`)
        .join('\n')}`;

      const modelText = await callGemini(geminiApiKey, prompt);
      const content = parseBriefingSections(modelText) || parseBriefingJson(modelText);

      if (content && typeof content.bulletPoints === 'string' && content.bulletPoints.trim()) {
        summaryText = content.bulletPoints.trim();
      } else {
        summaryText = cleanModelText(modelText) || 'Summary generated.';
      }

      if (content && typeof content.narrativeScript === 'string') {
        narrativeScript = content.narrativeScript.trim();
      }
    } catch {
      summaryText = 'Error generating summary.';
    }
  }

  const audioPlaylist = [];

  const inworldApiKey = env.INWORLD_API_KEY;
  const inworldSecret = env.INWORLD_SECRET;
  if (inworldApiKey && inworldSecret && narrativeScript && narrativeScript.length > 50) {
    try {
      const audio = await generateInworldAudio(
        inworldApiKey,
        inworldSecret,
        persona?.voiceId || 'Ashley',
        narrativeScript
      );
      audioPlaylist.push({ title: 'Daily Summary', url: audio.url, type: 'summary', voice: audio.voiceId });
    } catch {
      // Ignore audio failures.
    }
  }

  const briefing = {
    date,
    generatedAt: nowIso(),
    persona: { name: persona?.name || 'Unknown', voiceId: persona?.voiceId || 'Ashley' },
    summaryText,
    narrativeScript,
    audioPlaylist,
    articles
  };

  writeBriefingAtomic(date, briefing);
  return briefing;
}

async function getOrGenerateBriefing(force) {
  const date = localDateString();
  const key = `${date}:${force ? 'force' : 'cache'}`;

  const existing = inFlightByDate.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      return await generateDailyBriefing(force);
    } finally {
      inFlightByDate.delete(key);
    }
  })();

  inFlightByDate.set(key, p);
  return p;
}


function normalizeGameKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function canonicalGameName(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  const norm = normalizeGameKey(t);

  for (const k of Object.keys(GAME_REDDIT_SUBREDDITS)) {
    if (normalizeGameKey(k) === norm) return k;
  }

  return t;
}

function readConfiguredGames(env) {
  const raw = env.GAME_BRIEFING_GAMES;
  const list = parseStringList(raw);
  const desired = list.length ? list : DEFAULT_GAMES;

  const out = [];
  const seen = new Set();

  for (const name of desired) {
    const canon = canonicalGameName(name);
    const norm = normalizeGameKey(canon);
    if (!norm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(canon);
    if (out.length >= MAX_GAMES) break;
  }

  return out.length ? out : DEFAULT_GAMES.slice(0, 1);
}

function subredditForGame(game) {
  if (GAME_REDDIT_SUBREDDITS[game]) return GAME_REDDIT_SUBREDDITS[game];
  const norm = normalizeGameKey(game);

  for (const [k, v] of Object.entries(GAME_REDDIT_SUBREDDITS)) {
    if (normalizeGameKey(k) === norm) return v;
  }

  return null;
}

function normalizeMatchText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchGameForGenericItem(games, title, snippet) {
  const hay = normalizeMatchText(`${title || ''} ${snippet || ''}`);
  if (!hay) return null;

  for (const game of games) {
    const needle = normalizeMatchText(game);
    if (!needle) continue;
    if (hay.includes(needle)) return game;
  }

  return null;
}

function sortByPubDateDesc(list) {
  list.sort((a, b) => {
    const ta = Date.parse(String(a.pubDate || ''));
    const tb = Date.parse(String(b.pubDate || ''));
    const pa = Number.isNaN(ta) ? 0 : ta;
    const pb = Number.isNaN(tb) ? 0 : tb;
    return pb - pa;
  });
  return list;
}

async function generateGameBriefing(force) {
  const date = localDateString();

  const env = readEnvMap();
  const games = readConfiguredGames(env);
  const gamesKey = stableListKey(games);

  if (!force) {
    const existing = readGameBriefing(date);
    if (existing && existing.gamesKey === gamesKey) return existing;
  }

  const sources = [];
  let idx = 0;

  for (const game of games) {
    const sub = subredditForGame(game);
    if (!sub) continue;
    idx += 1;
    sources.push({
      id: `G${idx}`,
      name: `${game} (r/${sub})`,
      url: `https://www.reddit.com/r/${sub}/.rss`,
      game,
      enabled: true
    });
  }

  for (const src of GENERIC_GAME_SOURCES) {
    sources.push({ ...src, game: null });
  }

  const enabledSources = sources.filter((s) => s.enabled);

  const results = await mapLimit(enabledSources, 8, async (source) => {
    const items = await fetchAndParseFeed(source.url);
    return { source, items };
  });

  const articles = [];

  const perGameCount = new Map();
  const generalLimit = 30;
  let generalCount = 0;

  for (const { source, items } of results) {
    const limit = source.game ? GAME_SOURCE_ITEM_LIMIT : GENERIC_SOURCE_ITEM_LIMIT;

    for (const item of items.slice(0, limit)) {
      const title = item.title || '';
      const link = item.link || '';
      const snippet = item.contentSnippet || '';
      const pubDate = item.pubDate || '';
      const sourceName = source.name || '';

      let game = source.game || null;

      if (!game) {
        const matched = matchGameForGenericItem(games, title, snippet);
        game = matched || 'General';

        if (!matched) {
          if (generalCount >= generalLimit) continue;
          generalCount += 1;
        }
      }

      const k = game;
      const count = perGameCount.get(k) || 0;
      if (count >= MAX_ARTICLES_PER_GAME) continue;
      perGameCount.set(k, count + 1);

      articles.push({
        game,
        title,
        link,
        snippet,
        sourceName,
        pubDate
      });
    }
  }

  const byGame = new Map();
  for (const a of articles) {
    const k = a.game || 'General';
    const list = byGame.get(k);
    if (list) list.push(a);
    else byGame.set(k, [a]);
  }

  for (const [k, list] of byGame.entries()) {
    sortByPubDateDesc(list);
    byGame.set(k, list.slice(0, MAX_ARTICLES_PER_GAME));
  }

  const orderedGames = [...games, 'General'].filter((g, i, arr) => arr.indexOf(g) === i);
  const flattened = [];

  for (const g of orderedGames) {
    const list = byGame.get(g);
    if (list && list.length) flattened.push(...list);
  }

  const otherKeys = Array.from(byGame.keys()).filter((k) => !orderedGames.includes(k));
  otherKeys.sort((a, b) => String(a).localeCompare(String(b)));

  for (const k of otherKeys) {
    const list = byGame.get(k);
    if (list && list.length) flattened.push(...list);
  }

  const persona = chooseRandom(DEFAULT_PERSONAS) || DEFAULT_PERSONAS[0];

  let summaryText = 'No summary generated.';
  let narrativeScript = '';

  const geminiApiKey = env.GEMINI_API_KEY;
  if (geminiApiKey && flattened.length >= 3) {
    try {
      const personalityInstruction = persona?.personality
        ? `PERSONALITY: ${persona.personality}\n\nPresent the briefing in this character\'s style and voice.\n\n`
        : '';

      const itemLines = [];
      const maxPromptItemsPerGame = 10;

      for (const game of orderedGames) {
        const list = byGame.get(game) || [];
        for (const a of list.slice(0, maxPromptItemsPerGame)) {
          const snip = String(a.snippet || '').replace(/\s+/g, ' ').trim();
          const shortSnip = snip.length > 220 ? snip.slice(0, 217) + '...' : snip;
          itemLines.push(`[${game}] ${a.title}${shortSnip ? ` — ${shortSnip}` : ''}`);
        }
      }

      for (const k of otherKeys) {
        const list = byGame.get(k) || [];
        for (const a of list.slice(0, maxPromptItemsPerGame)) {
          const snip = String(a.snippet || '').replace(/\s+/g, ' ').trim();
          const shortSnip = snip.length > 220 ? snip.slice(0, 217) + '...' : snip;
          itemLines.push(`[${k}] ${a.title}${shortSnip ? ` — ${shortSnip}` : ''}`);
        }
      }

      const prompt = `${personalityInstruction}You are a gaming news researcher and host. Create a dashboard-friendly briefing for these games: ${games.join(
        ', '
      )}.\n\nIMPORTANT:\n- Use ONLY the provided headlines/snippets. Do not invent dates, banner end times, birthdays, event names, or rewards.\n- If an end date/birthday is not explicitly stated, say it is not specified in the sources.\n- Keep BULLETS concise and practical.\n- SCRIPT should be about 1-2 minutes when read aloud (about 200-400 words).\n- Do not use markdown.\n\nReturn exactly this format:\n\nBULLETS:\n- Game: key updates (include dates only if explicitly stated)\nSCRIPT:\nA narrative script in the persona's voice.\n\nItems:\n${itemLines.slice(0, 120).join('\n')}`;

      const modelText = await callGemini(geminiApiKey, prompt);
      const content = parseBriefingSections(modelText) || parseBriefingJson(modelText);

      if (content && typeof content.bulletPoints === 'string' && content.bulletPoints.trim()) {
        summaryText = content.bulletPoints.trim();
      } else {
        summaryText = cleanModelText(modelText) || 'Summary generated.';
      }

      if (content && typeof content.narrativeScript === 'string') {
        narrativeScript = content.narrativeScript.trim();
      }
    } catch {
      summaryText = 'Error generating summary.';
    }
  }

  const audioPlaylist = [];

  const inworldApiKey = env.INWORLD_API_KEY;
  const inworldSecret = env.INWORLD_SECRET;
  if (inworldApiKey && inworldSecret && narrativeScript && narrativeScript.length > 50) {
    try {
      const audio = await generateInworldAudio(
        inworldApiKey,
        inworldSecret,
        persona?.voiceId || 'Ashley',
        narrativeScript,
        'game-briefing'
      );
      audioPlaylist.push({
        title: 'Game Briefing',
        url: audio.url,
        type: 'summary',
        voice: audio.voiceId
      });
    } catch {
      // Ignore audio failures.
    }
  }

  const briefing = {
    date,
    generatedAt: nowIso(),
    games,
    gamesKey,
    persona: { name: persona?.name || 'Unknown', voiceId: persona?.voiceId || 'Ashley' },
    summaryText,
    narrativeScript,
    audioPlaylist,
    articles: flattened
  };

  writeGameBriefingAtomic(date, briefing);
  return briefing;
}

async function getOrGenerateGameBriefing(force) {
  const date = localDateString();
  const env = readEnvMap();
  const games = readConfiguredGames(env);
  const gamesKey = stableListKey(games);
  const key = `${date}:${gamesKey}:${force ? 'force' : 'cache'}`;

  const existing = inFlightGameByKey.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      return await generateGameBriefing(force);
    } finally {
      inFlightGameByKey.delete(key);
    }
  })();

  inFlightGameByKey.set(key, p);
  return p;
}

function topicPriority(topic, configuredTopics) {
  const normalized = normalizeTopicName(topic);
  const direct = configuredTopics.indexOf(normalized);
  if (direct !== -1) return direct;

  const fallback = RESEARCH_PAPER_TOPIC_PRIORITIES.indexOf(normalized);
  if (fallback !== -1) return configuredTopics.length + fallback;

  return 999;
}

function articleSortByTopicAndDate(a, b, configuredTopics) {
  const ta = topicPriority(a.topic, configuredTopics);
  const tb = topicPriority(b.topic, configuredTopics);
  if (ta !== tb) return ta - tb;

  const da = Number.isNaN(Date.parse(String(a.pubDate || ''))) ? 0 : Date.parse(String(a.pubDate || ''));
  const db = Number.isNaN(Date.parse(String(b.pubDate || ''))) ? 0 : Date.parse(String(b.pubDate || ''));
  return db - da;
}

async function generateResearchPaperBriefing(force) {
  throw new Error(`deprecated: generateResearchPaperBriefing(${force})`);
}

function listResearchPaperBriefingHistory() {
  try {
    if (!fs.existsSync(RESEARCH_PAPER_BRIEFINGS_DIR)) return [];
    const entries = fs.readdirSync(RESEARCH_PAPER_BRIEFINGS_DIR, { withFileTypes: true });
    const out = [];
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const name = String(ent.name || '');
      if (!name.endsWith('.json')) continue;
      const base = name.slice(0, -5);
      const period = normalizeMonthPeriod(base);
      if (period) out.push(period);
    }
    out.sort((a, b) => b.localeCompare(a));
    return out;
  } catch {
    return [];
  }
}

function buildResearchPaperPrompt(period, topics, persona, articles) {
  const personalityInstruction = persona?.personality
    ? `PERSONALITY: ${persona.personality}\n\nPresent this research briefing in this character\'s style and voice.\n\n`
    : '';

  const paperLines = (articles || []).slice(0, 90).map((a, idx) => {
    const snip = String(a.snippet || '').replace(/\s+/g, ' ').trim();
    const shortSnip = snip.length > 260 ? `${snip.slice(0, 257)}...` : snip;
    const linkText = a.link ? ` (${a.link})` : '';
    return `${idx + 1}. [${a.topic}] ${a.title}${shortSnip ? ` — ${shortSnip}` : ''}${linkText}`;
  });

  return `${personalityInstruction}You are a research curator and narrator. Create a research-paper briefing for period ${period}, focused on these topics: ${topics.join(
    ', '
  )}.

IMPORTANT:
- Prioritize AI first, then Tech, then Physics.
- Use ONLY the provided paper titles/snippets and links. Do not invent findings, claims, or results.
- Keep BULLETS concise and actionable.
- SCRIPT should be 2-3 minutes when read aloud (about 280-520 words).
- Mention a few specific paper titles in the script.
- Do not use markdown.

Return exactly this format:

BULLETS:
- Topic: concise summary line
SCRIPT:
A complete narrative script in the persona's voice.

Papers:
${paperLines.join('\n')}`;
}

function makeResearchPaperPlaceholder(period, topics, topicsKey) {
  return {
    period,
    runPolicy: 'monthly',
    nextEligiblePeriod: addMonths(period, 1),
    status: 'not_generated',
    message: 'No monthly snapshot yet. Press Run to start (limited to once per month).',
    topics,
    topicsKey,
    date: localDateString(),
    startedAt: '',
    generatedAt: '',
    modelUsed: '',
    modelCandidates: [],
    interaction: null,
    persona: null,
    summaryText: '',
    narrativeScript: '',
    audioPlaylist: [],
    articles: []
  };
}

function decorateResearchPaperResponse(period, briefing, env, currentTopics, currentTopicsKey, extraMessage = '') {
  const out =
    briefing && typeof briefing === 'object' && !Array.isArray(briefing) ? { ...briefing } : makeResearchPaperPlaceholder(period, currentTopics, currentTopicsKey);

  out.period = period;
  out.runPolicy = 'monthly';
  out.nextEligiblePeriod = addMonths(period, 1);

  if (out.topicsKey && currentTopicsKey && out.topicsKey !== currentTopicsKey) {
    out.configMismatch = {
      storedTopics: Array.isArray(out.topics) ? out.topics : [],
      storedTopicsKey: out.topicsKey,
      currentTopics,
      currentTopicsKey
    };
  }

  if (extraMessage) {
    out.message = extraMessage;
  } else if (!out.message) {
    out.message = '';
  }

  if (env && env.GEMINI_API_KEY) {
    out.geminiConfigured = true;
  } else {
    out.geminiConfigured = false;
  }

  return out;
}

async function fetchResearchPaperArticles(topics) {
  const sourceTopicSet = new Set((topics || []).map((t) => normalizeTopicName(t)));
  const sources = RESEARCH_PAPER_SOURCES.filter(
    (s) => s.enabled && sourceTopicSet.has(normalizeTopicName(s.topic))
  );

  const results = await mapLimit(sources, 8, async (source) => {
    const items = await fetchAndParseFeed(source.url);
    return { source, items };
  });

  const articles = [];
  const seen = new Set();

  for (const { source, items } of results) {
    for (const item of items.slice(0, RESEARCH_PAPER_ITEM_LIMIT_PER_SOURCE)) {
      const title = item.title || '';
      const link = item.link || '';
      const snippet = item.contentSnippet || '';
      const pubDate = item.pubDate || '';
      const topic = normalizeTopicName(source.topic) || 'Other';

      if (!title && !link) continue;
      const dedupeKey = `${topic}|${String(link).trim()}|${String(title).trim().toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      articles.push({
        topic,
        title,
        link,
        snippet,
        sourceName: source.name || '',
        pubDate
      });
    }
  }

  articles.sort((a, b) => articleSortByTopicAndDate(a, b, topics));
  return articles.slice(0, MAX_RESEARCH_ARTICLES);
}

function applyModelTextToBriefing(briefing, modelText) {
  const content = parseBriefingSections(modelText) || parseBriefingJson(modelText);

  if (content && typeof content.bulletPoints === 'string' && content.bulletPoints.trim()) {
    briefing.summaryText = content.bulletPoints.trim();
  } else {
    briefing.summaryText = cleanModelText(modelText) || 'Summary generated.';
  }

  if (content && typeof content.narrativeScript === 'string') {
    briefing.narrativeScript = content.narrativeScript.trim();
  }
}

async function finalizeResearchPaperBriefing(briefing, env, modelText) {
  applyModelTextToBriefing(briefing, modelText);
  briefing.status = 'completed';
  briefing.generatedAt = nowIso();

  briefing.audioPlaylist = Array.isArray(briefing.audioPlaylist) ? briefing.audioPlaylist : [];

  const inworldApiKey = env.INWORLD_API_KEY;
  const inworldSecret = env.INWORLD_SECRET;
  const narrative = String(briefing.narrativeScript || '').trim();

  if (inworldApiKey && inworldSecret && narrative.length > 50) {
    try {
      const voiceId = briefing?.persona?.voiceId || 'Ashley';
      const audio = await generateInworldAudio(
        inworldApiKey,
        inworldSecret,
        voiceId,
        narrative,
        `research-papers-${briefing.period || 'monthly'}`
      );
      briefing.audioPlaylist.push({
        title: 'Research Papers Briefing',
        url: audio.url,
        type: 'summary',
        voice: audio.voiceId
      });
    } catch {
      // Ignore audio failures.
    }
  }
}

async function pollResearchPaperInteractionIfReady(existing, env) {
  if (!existing || typeof existing !== 'object') return existing;
  const interaction = existing.interaction && typeof existing.interaction === 'object' ? existing.interaction : null;
  const id = interaction && interaction.id ? String(interaction.id).trim() : '';
  if (!id) return existing;

  const status = String(existing.status || interaction.status || '').trim();
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return existing;

  const geminiApiKey = env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    existing.message = 'Missing GEMINI_API_KEY; cannot poll interaction.';
    return existing;
  }

  let latest = null;
  try {
    latest = await getGeminiInteraction(geminiApiKey, id);
  } catch (e) {
    existing.message = e instanceof Error ? e.message : String(e);
    return existing;
  }

  const latestStatus = String(latest?.status || '').trim() || 'in_progress';
  existing.interaction = {
    ...(interaction || {}),
    status: latestStatus,
    updated: latest?.updated || nowIso()
  };
  existing.status = latestStatus;

  if (latestStatus === 'completed') {
    const modelText = interactionTextFromOutputs(latest?.outputs) || '';
    if (!modelText) {
      existing.status = 'failed';
      existing.message = 'Interaction completed but returned no text output.';
      return existing;
    }

    existing.modelUsed = existing.modelUsed || existing.interaction?.agent || '';
    await finalizeResearchPaperBriefing(existing, env, modelText);
    return existing;
  }

  if (latestStatus === 'failed' || latestStatus === 'cancelled') {
    existing.message = 'Interaction failed.';
    return existing;
  }

  existing.message = 'Generation in progress. Check back later.';
  return existing;
}

async function getResearchPaperBriefing(period) {
  const p = normalizeMonthPeriod(period) || localMonthString();
  const env = readEnvMap();
  const topics = readResearchPaperTopics(env);
  const topicsKey = stableListKey(topics);

  const existing = readResearchPaperBriefing(p);
  if (!existing) {
    return decorateResearchPaperResponse(p, null, env, topics, topicsKey);
  }

  const updated = await pollResearchPaperInteractionIfReady({ ...existing }, env);
  if (updated && updated.status !== existing.status) {
    try {
      writeResearchPaperBriefingAtomic(p, updated);
    } catch {
      // ignore
    }
  } else if (updated && updated.status === 'completed' && !existing.generatedAt && updated.generatedAt) {
    try {
      writeResearchPaperBriefingAtomic(p, updated);
    } catch {
      // ignore
    }
  }

  return decorateResearchPaperResponse(p, updated, env, topics, topicsKey);
}

async function refreshResearchPaperBriefing(period) {
  const p = normalizeMonthPeriod(period) || localMonthString();
  const env = readEnvMap();
  const topics = readResearchPaperTopics(env);
  const topicsKey = stableListKey(topics);
  const modelCandidates = readResearchPaperGeminiModels(env);

  const existing = readResearchPaperBriefing(p);
  if (existing) {
    const updated = await pollResearchPaperInteractionIfReady({ ...existing }, env);
    if (updated && updated.status !== existing.status) {
      writeResearchPaperBriefingAtomic(p, updated);
    }

    if (String(updated?.status || '') === 'completed') {
      return decorateResearchPaperResponse(
        p,
        updated,
        env,
        topics,
        topicsKey,
        `Already generated for ${p}. Next eligible period: ${addMonths(p, 1)}.`
      );
    }

    writeResearchPaperBriefingAtomic(p, updated);
    return decorateResearchPaperResponse(p, updated, env, topics, topicsKey);
  }

  const geminiApiKey = env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    return decorateResearchPaperResponse(
      p,
      null,
      env,
      topics,
      topicsKey,
      'Missing GEMINI_API_KEY. Set it on the Config page to enable summarization.'
    );
  }

  const articles = await fetchResearchPaperArticles(topics);
  const persona = chooseRandom(DEFAULT_PERSONAS) || DEFAULT_PERSONAS[0];
  const prompt = buildResearchPaperPrompt(p, topics, persona, articles);

  const base = {
    period: p,
    runPolicy: 'monthly',
    nextEligiblePeriod: addMonths(p, 1),
    status: 'starting',
    message: '',
    date: localDateString(),
    startedAt: nowIso(),
    generatedAt: '',
    topics,
    topicsKey,
    modelUsed: '',
    modelCandidates,
    interaction: null,
    persona: { name: persona?.name || 'Unknown', voiceId: persona?.voiceId || 'Ashley' },
    summaryText: '',
    narrativeScript: '',
    audioPlaylist: [],
    articles
  };

  // Start agent interaction (async) so we can poll later without re-executing the agent.
  try {
    const created = await createGeminiAgentInteraction(
      geminiApiKey,
      RESEARCH_PAPER_INTERACTION_AGENT,
      prompt
    );

    base.status = String(created?.status || 'in_progress') || 'in_progress';
    base.interaction = {
      id: created?.id || '',
      agent: created?.agent || RESEARCH_PAPER_INTERACTION_AGENT,
      status: String(created?.status || 'in_progress') || 'in_progress',
      created: created?.created || nowIso(),
      updated: created?.updated || nowIso()
    };
    base.modelUsed = base.interaction.agent;
    base.message = 'Generation started (monthly). This may take a bit; refresh to poll status.';

    writeResearchPaperBriefingAtomic(p, base);
    return decorateResearchPaperResponse(p, base, env, topics, topicsKey);
  } catch (e) {
    // Fallback: standard generateContent path (still counts as the monthly run).
    let modelText = '';
    let modelUsed = '';
    let lastErr = e instanceof Error ? e : new Error(String(e));

    for (const model of modelCandidates) {
      try {
        const out = await callGeminiModel(geminiApiKey, model, prompt);
        if (cleanModelText(out)) {
          modelText = out;
          modelUsed = model;
          break;
        }
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
    }

    if (!modelText) {
      return decorateResearchPaperResponse(
        p,
        null,
        env,
        topics,
        topicsKey,
        lastErr ? lastErr.message : 'Failed to start generation.'
      );
    }

    base.status = 'completed';
    base.modelUsed = modelUsed;
    await finalizeResearchPaperBriefing(base, env, modelText);
    writeResearchPaperBriefingAtomic(p, base);
    return decorateResearchPaperResponse(p, base, env, topics, topicsKey);
  }
}

async function getOrDoResearchPaperBriefing(period, action) {
  const p = normalizeMonthPeriod(period) || localMonthString();
  const key = `${p}:${action}`;

  const existing = inFlightResearchPaperByKey.get(key);
  if (existing) return existing;

  const fn = action === 'refresh' ? refreshResearchPaperBriefing : getResearchPaperBriefing;

  const promise = (async () => {
    try {
      return await fn(p);
    } finally {
      inFlightResearchPaperByKey.delete(key);
    }
  })();

  inFlightResearchPaperByKey.set(key, promise);
  return promise;
}

async function generatePodcastVideos(force) {
  const date = localDateString();
  if (!force) {
    const existing = readPodcastVideos(date);
    if (existing) return existing;
  }

  const sources = PODCAST_VIDEO_SOURCES.slice();
  const recentCutoffMs =
    Date.now() -
    3600000 *
      (Number.isFinite(PODCAST_VIDEO_RECENT_HOURS) && PODCAST_VIDEO_RECENT_HOURS > 0
        ? PODCAST_VIDEO_RECENT_HOURS
        : 30);

  const fetchResults = await mapLimit(sources, 4, async (source) => {
    try {
      const feedUrl = await resolveYouTubeFeedUrl(source.channelUrl);
      const raw = await fetchAndParseFeed(feedUrl);
      const normalized = [];

      for (const item of raw.slice(0, 40)) {
        const videoId = parseYouTubeVideoId(item.link);
        if (!videoId) continue;
        const publishedAt = item.pubDate || '';
        const publishedMs = Number.isNaN(Date.parse(publishedAt)) ? 0 : Date.parse(publishedAt);
        const isShort = detectShortFromMeta(item);

        const mode = String(source.mode || 'videos');
        if (mode === 'shorts' && !isShort) continue;
        if (mode === 'videos' && isShort) continue;

        normalized.push({
          sourceId: source.id,
          sourceName: source.name,
          mode,
          title: item.title || `YouTube ${videoId}`,
          link: `https://www.youtube.com/watch?v=${videoId}`,
          videoId,
          publishedAt,
          publishedMs,
          isShort,
          estimatedSeconds: estimateVideoSeconds({ isShort }, source)
        });
      }

      normalized.sort((a, b) => b.publishedMs - a.publishedMs);
      return { source, items: normalized, feedUrl, error: '' };
    } catch (e) {
      return {
        source,
        items: [],
        feedUrl: '',
        error: e instanceof Error ? e.message : String(e)
      };
    }
  });

  const allItems = [];
  const errors = {};
  const sourceMeta = [];

  for (const result of fetchResults) {
    if (result.error) errors[result.source.id] = result.error;
    sourceMeta.push({
      id: result.source.id,
      name: result.source.name,
      mode: result.source.mode,
      feedUrl: result.feedUrl || '',
      count: result.items.length
    });
    for (const item of result.items) allItems.push(item);
  }

  const deduped = [];
  const seen = new Set();
  for (const item of allItems) {
    const key = item.videoId || item.link;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const recentItems = deduped
    .filter((v) => v.publishedMs >= recentCutoffMs)
    .sort((a, b) => b.publishedMs - a.publishedMs);
  const olderItems = deduped.filter((v) => v.publishedMs < recentCutoffMs);

  const targetSeconds =
    Number.isFinite(PODCAST_VIDEO_TARGET_SECONDS) && PODCAST_VIDEO_TARGET_SECONDS > 0
      ? PODCAST_VIDEO_TARGET_SECONDS
      : 3600;

  const playlist = [];
  let totalSeconds = 0;

  for (const item of recentItems) {
    playlist.push({ ...item, pickReason: 'recent' });
    totalSeconds += item.estimatedSeconds;
  }

  if (totalSeconds < targetSeconds && olderItems.length) {
    const rand = makeSeededRandom(`${date}:podcast-videos`);
    const randomized = shuffleWithRandom(olderItems, rand);
    for (const item of randomized) {
      playlist.push({ ...item, pickReason: 'fill-random' });
      totalSeconds += item.estimatedSeconds;
      if (totalSeconds >= targetSeconds) break;
    }
  }

  const output = {
    date,
    generatedAt: nowIso(),
    targetSeconds,
    targetMinutes: Math.round(targetSeconds / 60),
    totalSeconds,
    totalMinutes: Math.round(totalSeconds / 60),
    recentCutoffHours:
      Number.isFinite(PODCAST_VIDEO_RECENT_HOURS) && PODCAST_VIDEO_RECENT_HOURS > 0
        ? PODCAST_VIDEO_RECENT_HOURS
        : 30,
    exceededTargetWithRecent: totalSeconds > targetSeconds && recentItems.length > 0,
    sourceMeta,
    playlist,
    errors
  };

  writePodcastVideosAtomic(date, output);
  return output;
}

async function getOrGeneratePodcastVideos(force) {
  const date = localDateString();
  const key = `${date}:${force ? 'force' : 'cache'}`;
  const existing = inFlightPodcastByDate.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      return await generatePodcastVideos(force);
    } finally {
      inFlightPodcastByDate.delete(key);
    }
  })();

  inFlightPodcastByDate.set(key, p);
  return p;
}


function buildPi2AltUrl(pathname) {
  const suffix = String(pathname || '').startsWith('/') ? String(pathname || '') : `/${pathname || ''}`;
  return `${PI2_ALT_BASE_URL}${suffix}`;
}

function parseNumberLoose(raw) {
  const text = String(raw == null ? '' : raw)
    .replace(/[$,%]/g, '')
    .replace(/,/g, '')
    .trim();
  if (!text) return null;
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

function parseMorningScannerCandidates(logText) {
  const lines = String(logText || '').split(/\r?\n/);
  const out = [];

  for (const line of lines) {
    const m = line.match(
      /^\s*([A-Z][A-Z0-9.\-]{0,9})\s+([0-9]+(?:\.[0-9]+)?)\s+(bull|bear)\s+([0-9]+(?:\.[0-9]+)?)\s+(-?[0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)\s+(-?[0-9]+(?:\.[0-9]+)?)/i
    );
    if (!m) continue;

    out.push({
      ticker: m[1],
      score: Number.parseFloat(m[2]),
      dir: m[3].toLowerCase(),
      close: Number.parseFloat(m[4]),
      roc3: Number.parseFloat(m[5]),
      volSurge: Number.parseFloat(m[6]),
      rs5d: Number.parseFloat(m[7])
    });
  }

  return out;
}

function extractTradeMetric(logText, label) {
  const escapedLabel = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = String(logText || '').match(new RegExp(`${escapedLabel}:\\s*([^\\n]+)`));
  return m ? m[1].trim() : '';
}

function parseAccountSnapshotFromTradeLog(logText) {
  const cash = parseNumberLoose(extractTradeMetric(logText, 'Cash'));
  const equity = parseNumberLoose(extractTradeMetric(logText, 'Equity'));
  const buyingPower = parseNumberLoose(extractTradeMetric(logText, 'Buying power'));
  const openPositions = parseNumberLoose(extractTradeMetric(logText, 'Open positions'));
  const openOrders = parseNumberLoose(extractTradeMetric(logText, 'Open orders'));

  return {
    cash,
    equity,
    buyingPower,
    openPositions,
    openOrders
  };
}

function readJsonFileSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

function getFileAgeMs(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return Date.now() - stat.mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function buildScannerCandidatesFromResearch(research) {
  const picks = Array.isArray(research?.top_picks) ? research.top_picks : [];
  const out = [];

  for (const pick of picks.slice(0, 12)) {
    const score = parseNumberLoose(pick?.score);
    const close = parseNumberLoose(pick?.price);
    const roc3 = parseNumberLoose(pick?.change_pct);
    const volSurge = parseNumberLoose(pick?.vol_surge);
    const momentum5d = parseNumberLoose(pick?.momentum_5d);

    const directionRaw = String(pick?.trade_idea?.direction || '')
      .trim()
      .toLowerCase();
    let dir = 'neutral';
    if (directionRaw.includes('call') || directionRaw.includes('bull')) dir = 'bull';
    if (directionRaw.includes('put') || directionRaw.includes('bear')) dir = 'bear';

    out.push({
      ticker: String(pick?.ticker || '').toUpperCase(),
      score: score == null ? null : score,
      dir,
      close: close == null ? null : close,
      roc3: roc3 == null ? null : roc3,
      volSurge: volSurge == null ? null : volSurge,
      rs5d: momentum5d == null ? null : momentum5d / 100
    });
  }

  return out;
}

function firstFiniteValue(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeSignalDirection(rawDirection, rawFallbackDirection) {
  const primary = String(rawDirection || '')
    .trim()
    .toUpperCase();
  const fallback = String(rawFallbackDirection || '')
    .trim()
    .toUpperCase();

  if (primary === 'STRADDLE' || primary === 'NEUTRAL' || primary === '') {
    if (fallback === 'CALL' || fallback === 'PUT') return fallback;
  }
  return primary || fallback || 'NEUTRAL';
}

function buildAutomatedTradesFromResearch(research, positions, openOrders, runtimeStatus) {
  const picks = Array.isArray(research?.top_picks) ? research.top_picks : [];
  if (!picks.length) return [];

  const positionMap = new Map();
  for (const position of Array.isArray(positions) ? positions : []) {
    const symbol = String(position?.symbol || '')
      .trim()
      .toUpperCase();
    if (!symbol) continue;
    positionMap.set(symbol, position);
  }

  const orderMap = new Map();
  for (const order of Array.isArray(openOrders) ? openOrders : []) {
    const symbol = String(order?.symbol || '')
      .trim()
      .toUpperCase();
    if (!symbol) continue;
    const current = orderMap.get(symbol) || [];
    current.push(order);
    orderMap.set(symbol, current);
  }

  const serviceState = String(runtimeStatus?.services?.alpacaTrader?.active || '')
    .trim()
    .toLowerCase();
  const automationActive = serviceState === 'active' || serviceState === 'running';

  const rows = [];

  for (const pick of picks.slice(0, 12)) {
    const ticker = String(pick?.ticker || '')
      .trim()
      .toUpperCase();
    if (!ticker) continue;

    const tradeIdea = pick?.trade_idea && typeof pick.trade_idea === 'object' ? pick.trade_idea : {};
    const entryExit = tradeIdea?.entry_exit && typeof tradeIdea.entry_exit === 'object' ? tradeIdea.entry_exit : {};

    const direction = normalizeSignalDirection(tradeIdea?.direction, entryExit?.direction);
    const score = parseNumberLoose(pick?.score);
    const entryPrice = firstFiniteValue(parseNumberLoose(entryExit?.stock_entry), parseNumberLoose(pick?.price));
    const position = positionMap.get(ticker) || null;
    const orders = orderMap.get(ticker) || [];

    const orderTarget = firstFiniteValue(
      ...orders.map((order) => parseNumberLoose(order?.limitPrice)),
      ...orders.map((order) => parseNumberLoose(order?.takeProfitPrice))
    );
    const orderStop = firstFiniteValue(...orders.map((order) => parseNumberLoose(order?.stopPrice)));

    const targetPrice = firstFiniteValue(orderTarget, parseNumberLoose(entryExit?.stock_target));
    const stopPrice = firstFiniteValue(orderStop, parseNumberLoose(entryExit?.stock_stop));

    let status = 'inactive';
    if (position) status = 'active';
    else if (orders.length) status = 'queued';
    else if (automationActive) status = 'watching';

    rows.push({
      ticker,
      score,
      direction,
      status,
      entryPrice,
      targetPrice,
      stopPrice,
      positionQty: position ? parseNumberLoose(position?.qty) : null,
      openOrderCount: orders.length
    });
  }

  return rows;
}

function runTradingResearchScript() {
  if (inFlightTradingResearchRun) return inFlightTradingResearchRun;

  ensureDir(TRADING_RESEARCH_DATA_DIR, 0o700);

  const p = new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PI5_DASHBOARD_ENV_PATH: ENV_PATH,
      TRADING_RESEARCH_DATA_DIR
    };

    const child = spawn(TRADING_RESEARCH_PYTHON, [TRADING_RESEARCH_SCRIPT], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const cap = 16000;

    const logStream = fs.createWriteStream(TRADING_RESEARCH_LOG_FILE, {
      flags: 'a',
      mode: 0o600
    });

    logStream.write(`\n[${nowIso()}] on-demand trading research run started\n`);

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      if (stdout.length < cap) stdout += text.slice(0, cap - stdout.length);
      logStream.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (stderr.length < cap) stderr += text.slice(0, cap - stderr.length);
      logStream.write(text);
    });

    const timeoutMs =
      Number.isFinite(TRADING_RESEARCH_RUN_TIMEOUT_MS) && TRADING_RESEARCH_RUN_TIMEOUT_MS > 0
        ? TRADING_RESEARCH_RUN_TIMEOUT_MS
        : 300000;
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timeout);
      logStream.write(`[${nowIso()}] on-demand run failed to start: ${err.message}\n`);
      logStream.end();
      reject(err);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      logStream.write(`[${nowIso()}] on-demand run exited code=${code} signal=${signal || 'none'}\n`);
      logStream.end();

      if (code === 0) {
        resolve({ ok: true, stdout, stderr });
        return;
      }

      const reason = signal ? `signal ${signal}` : `exit ${code}`;
      reject(new Error(`trading research agent failed (${reason}): ${(stderr || stdout).slice(0, 300)}`));
    });
  }).finally(() => {
    inFlightTradingResearchRun = null;
  });

  inFlightTradingResearchRun = p;
  return p;
}

async function fetchJsonWithTimeout(url, opts = {}) {
  const timeoutMs =
    Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 15_000;
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    ...(opts.headers && typeof opts.headers === 'object' ? opts.headers : {})
  };

  const r = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    method: opts.method || 'GET',
    headers
  });

  if (!r.ok) {
    throw new Error(`HTTP ${r.status}`);
  }

  const text = await r.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('invalid json');
  }
}

async function fetchAlpacaAccountSnapshot(env) {
  const key =
    env?.ALPACA_API_KEY_ID || env?.APCA_API_KEY_ID || env?.ALPACA_API_KEY || env?.APCA_API_KEY;
  const secret =
    env?.ALPACA_API_SECRET_KEY ||
    env?.APCA_API_SECRET_KEY ||
    env?.ALPACA_SECRET_KEY ||
    env?.APCA_API_SECRET;
  const explicitBase = String(env?.APCA_API_BASE_URL || '').trim();
  const baseCandidates = explicitBase
    ? [explicitBase]
    : ['https://paper-api.alpaca.markets', 'https://api.alpaca.markets'];

  if (!key || !secret) {
    return {
      account: {
        cash: null,
        equity: null,
        buyingPower: null,
        openPositions: null,
        openOrders: null
      },
      positions: [],
      openOrders: [],
      executionMode: 'unknown',
      error: 'missing ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY'
    };
  }

  const headers = {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret
  };

  const baseErrors = [];

  for (const rawBase of baseCandidates) {
    const base = String(rawBase || '').replace(/\/+$/, '');
    if (!base) continue;

    const [accountRes, positionsRes, ordersRes] = await Promise.allSettled([
      fetchJsonWithTimeout(`${base}/v2/account`, { headers, timeoutMs: 12_000 }),
      fetchJsonWithTimeout(`${base}/v2/positions`, { headers, timeoutMs: 12_000 }),
      fetchJsonWithTimeout(`${base}/v2/orders?status=open&limit=200`, { headers, timeoutMs: 12_000 })
    ]);

    const errors = [];
    const accountRaw =
      accountRes.status === 'fulfilled' && accountRes.value && typeof accountRes.value === 'object'
        ? accountRes.value
        : null;
    if (!accountRaw) {
      const reason =
        accountRes.status === 'rejected'
          ? accountRes.reason instanceof Error
            ? accountRes.reason.message
            : String(accountRes.reason)
          : 'invalid payload';
      errors.push(`account: ${reason}`);
    }

    const positions =
      positionsRes.status === 'fulfilled' && Array.isArray(positionsRes.value) ? positionsRes.value : null;
    if (!positions) {
      const reason =
        positionsRes.status === 'rejected'
          ? positionsRes.reason instanceof Error
            ? positionsRes.reason.message
            : String(positionsRes.reason)
          : 'invalid payload';
      errors.push(`positions: ${reason}`);
    }

    const orders =
      ordersRes.status === 'fulfilled' && Array.isArray(ordersRes.value) ? ordersRes.value : null;
    if (!orders) {
      const reason =
        ordersRes.status === 'rejected'
          ? ordersRes.reason instanceof Error
            ? ordersRes.reason.message
            : String(ordersRes.reason)
          : 'invalid payload';
      errors.push(`orders: ${reason}`);
    }

    if (accountRaw) {
      const normalizedPositions = (positions || []).map((position) => ({
        symbol: String(position?.symbol || ''),
        qty: parseNumberLoose(position?.qty),
        side: String(position?.side || ''),
        currentPrice: parseNumberLoose(position?.current_price),
        avgEntryPrice: parseNumberLoose(position?.avg_entry_price),
        unrealizedPl: parseNumberLoose(position?.unrealized_pl)
      }));

      const normalizedOrders = (orders || []).map((order) => {
        const legs = Array.isArray(order?.legs) ? order.legs : [];

        const takeProfitPrice = firstFiniteValue(
          ...legs.map((leg) => parseNumberLoose(leg?.limit_price))
        );
        const stopPriceFromLegs = firstFiniteValue(
          ...legs.map((leg) => parseNumberLoose(leg?.stop_price))
        );

        return {
          id: String(order?.id || ''),
          symbol: String(order?.symbol || ''),
          side: String(order?.side || ''),
          status: String(order?.status || ''),
          type: String(order?.type || ''),
          orderClass: String(order?.order_class || ''),
          limitPrice: parseNumberLoose(order?.limit_price),
          stopPrice: firstFiniteValue(parseNumberLoose(order?.stop_price), stopPriceFromLegs),
          takeProfitPrice,
          submittedAt: String(order?.submitted_at || order?.created_at || '')
        };
      });

      return {
        account: {
          cash: parseNumberLoose(accountRaw?.cash),
          equity: parseNumberLoose(accountRaw?.equity),
          buyingPower: parseNumberLoose(accountRaw?.buying_power),
          openPositions: positions ? positions.length : null,
          openOrders: orders ? orders.length : null
        },
        positions: normalizedPositions,
        openOrders: normalizedOrders,
        executionMode: base.includes('paper-api') ? 'paper' : 'live',
        error: errors.length ? errors.join('; ') : ''
      };
    }

    baseErrors.push(`${base}: ${errors.join('; ') || 'request failed'}`);
  }

  return {
    account: {
      cash: null,
      equity: null,
      buyingPower: null,
      openPositions: null,
      openOrders: null
    },
    positions: [],
    openOrders: [],
    executionMode: 'unknown',
    error: baseErrors.join(' | ')
  };
}

function systemctlState(unit) {
  const result = spawnSync('systemctl', ['is-active', unit], {
    encoding: 'utf8',
    timeout: 4000
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`.trim().toLowerCase();
  if (!output) return 'unknown';

  const token = output.split(/\s+/)[0];
  return token || 'unknown';
}

function systemctlEnabled(unit) {
  const result = spawnSync('systemctl', ['is-enabled', unit], {
    encoding: 'utf8',
    timeout: 4000
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`.trim().toLowerCase();
  if (!output) return 'unknown';

  const token = output.split(/\s+/)[0];
  return token || 'unknown';
}

function readUserCrontabLines() {
  const result = spawnSync('crontab', ['-l'], {
    encoding: 'utf8',
    timeout: 4000
  });

  const stderr = String(result.stderr || '');
  if (result.status !== 0 && /no crontab for/i.test(stderr)) {
    return [];
  }

  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function readTradingRuntimeStatus() {
  const services = {
    alpacaTrader: {
      unit: 'alpaca-trader',
      active: systemctlState('alpaca-trader'),
      enabled: systemctlEnabled('alpaca-trader')
    },
    qqq0dte: {
      unit: 'qqq0dte',
      active: systemctlState('qqq0dte'),
      enabled: systemctlEnabled('qqq0dte')
    }
  };

  const cronLines = readUserCrontabLines();
  const hasLine = (needle) => cronLines.some((line) => line.includes(needle));

  const cron = {
    entries: cronLines.length,
    aggressiveOpen: hasLine('cron_aggressive_call_momentum_V1_open.cron.sh'),
    aggressiveManage: hasLine('cron_aggressive_call_momentum_V1_manage.cron.sh'),
    tqqqOpen: hasLine('cron_tqqq_sqqq_daily_V3_open.cron.sh'),
    tqqqManage: hasLine('cron_tqqq_sqqq_daily_V3_manage.cron.sh')
  };

  return { services, cron };
}

async function fetchAlpacaTradingStatus(env) {
  const key =
    env?.ALPACA_API_KEY_ID || env?.APCA_API_KEY_ID || env?.ALPACA_API_KEY || env?.APCA_API_KEY;
  const secret =
    env?.ALPACA_API_SECRET_KEY ||
    env?.APCA_API_SECRET_KEY ||
    env?.ALPACA_SECRET_KEY ||
    env?.APCA_API_SECRET;
  const explicitBase = String(env?.APCA_API_BASE_URL || '').trim();
  const baseCandidates = explicitBase
    ? [explicitBase]
    : ['https://paper-api.alpaca.markets', 'https://api.alpaca.markets'];

  if (!key || !secret) {
    return {
      cash: null,
      equity: null,
      dayPL: null,
      positions: [],
      error: 'missing ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY'
    };
  }

  const headers = {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret
  };

  const baseErrors = [];

  for (const rawBase of baseCandidates) {
    const base = String(rawBase || '').replace(/\/+$/, '');
    if (!base) continue;

    const [accountRes, positionsRes] = await Promise.allSettled([
      fetchJsonWithTimeout(`${base}/v2/account`, { headers, timeoutMs: 12_000 }),
      fetchJsonWithTimeout(`${base}/v2/positions`, { headers, timeoutMs: 12_000 })
    ]);

    const errors = [];
    const accountRaw =
      accountRes.status === 'fulfilled' && accountRes.value && typeof accountRes.value === 'object'
        ? accountRes.value
        : null;
    if (!accountRaw) {
      const reason =
        accountRes.status === 'rejected'
          ? accountRes.reason instanceof Error
            ? accountRes.reason.message
            : String(accountRes.reason)
          : 'invalid payload';
      errors.push(`account: ${reason}`);
    }

    const positionsRaw =
      positionsRes.status === 'fulfilled' && Array.isArray(positionsRes.value) ? positionsRes.value : null;
    if (!positionsRaw) {
      const reason =
        positionsRes.status === 'rejected'
          ? positionsRes.reason instanceof Error
            ? positionsRes.reason.message
            : String(positionsRes.reason)
          : 'invalid payload';
      errors.push(`positions: ${reason}`);
    }

    if (accountRaw) {
      const equity = parseNumberLoose(accountRaw?.equity);
      const lastEquity = parseNumberLoose(accountRaw?.last_equity);

      return {
        cash: parseNumberLoose(accountRaw?.cash),
        equity,
        dayPL: equity != null && lastEquity != null ? equity - lastEquity : null,
        positions: (positionsRaw || []).map((p) => ({
          symbol: String(p?.symbol || ''),
          qty: parseNumberLoose(p?.qty) ?? 0,
          current_price: parseNumberLoose(p?.current_price) ?? 0,
          avg_entry_price: parseNumberLoose(p?.avg_entry_price) ?? 0,
          unrealized_pl: parseNumberLoose(p?.unrealized_pl) ?? 0,
          unrealized_plpc: parseNumberLoose(p?.unrealized_plpc) ?? 0
        })),
        error: errors.length ? errors.join('; ') : ''
      };
    }

    baseErrors.push(`${base}: ${errors.join('; ') || 'request failed'}`);
  }

  return {
    cash: null,
    equity: null,
    dayPL: null,
    positions: [],
    error: baseErrors.join(' | ') || 'unable to fetch account status'
  };
}

async function generateLocalTradingResearchSnapshot(force) {
  ensureDir(TRADING_RESEARCH_DATA_DIR, 0o700);

  const staleMs =
    Number.isFinite(TRADING_RESEARCH_LOCAL_STALE_MS) && TRADING_RESEARCH_LOCAL_STALE_MS > 0
      ? TRADING_RESEARCH_LOCAL_STALE_MS
      : 21600000;

  let research = readJsonFileSafe(TRADING_RESEARCH_OUTPUT_FILE);
  const journalRaw = readJsonFileSafe(TRADING_RESEARCH_JOURNAL_FILE);
  const journalEntries = Array.isArray(journalRaw) ? journalRaw : [];
  const ageMs = getFileAgeMs(TRADING_RESEARCH_OUTPUT_FILE);

  const errors = {};

  if (force || !research) {
    try {
      await runTradingResearchScript();
      research = readJsonFileSafe(TRADING_RESEARCH_OUTPUT_FILE);
    } catch (e) {
      errors.agent = e instanceof Error ? e.message : String(e);
    }
  } else if (ageMs > staleMs && !inFlightTradingResearchRun) {
    // Keep non-forced reads fast: return stale data now and refresh in background.
    runTradingResearchScript().catch(() => {});
  }

  if (!research && !journalEntries.length) {
    throw new Error('local trading research data unavailable');
  }

  const topPicks = Array.isArray(research?.top_picks) ? research.top_picks : [];
  const scannerCandidates = buildScannerCandidatesFromResearch(research);
  const runtimeStatus = readTradingRuntimeStatus();
  const accountInfo = await fetchAlpacaAccountSnapshot(readEnvMap());
  if (accountInfo.error) {
    errors.account = accountInfo.error;
  }

  const automatedTrades = buildAutomatedTradesFromResearch(
    research,
    accountInfo.positions,
    accountInfo.openOrders,
    runtimeStatus
  );

  const payload = {
    generatedAt: nowIso(),
    sourceBaseUrl: 'local:pi5-trading-research',
    research: research || null,
    journalEntries,
    overviewTopPicks: topPicks.slice(0, 5),
    scannerCandidates,
    account: accountInfo.account,
    automation: {
      active:
        String(runtimeStatus?.services?.alpacaTrader?.active || '')
          .trim()
          .toLowerCase() === 'active',
      service: runtimeStatus?.services?.alpacaTrader?.active || 'unknown',
      enabled: runtimeStatus?.services?.alpacaTrader?.enabled || 'unknown',
      mode: accountInfo.executionMode || 'unknown'
    },
    automatedTrades,
    strategyStatus: {
      alpaca_trader_service: runtimeStatus?.services?.alpacaTrader?.active || 'unknown',
      qqq0dte_service: runtimeStatus?.services?.qqq0dte?.active || 'unknown',
      trading_research_agent: inFlightTradingResearchRun ? 'running' : 'enabled',
      trigger: 'pi5-local cron + on-demand refresh'
    },
    openclaw: {
      pcOnline: null,
      nextWake: '',
      updatedAt: research?.generated_at || nowIso()
    },
    errors
  };

  return payload;
}

async function generatePi2TradingResearchSnapshot() {
  const researchUrl = buildPi2AltUrl('/api/research');
  const journalUrl = buildPi2AltUrl('/api/research_journal.json');
  const statusUrl = buildPi2AltUrl('/api/openclaw/status');

  const [researchRes, journalRes, statusRes] = await Promise.allSettled([
    fetchJsonWithTimeout(researchUrl),
    fetchJsonWithTimeout(journalUrl),
    fetchJsonWithTimeout(statusUrl)
  ]);

  let research = null;
  let journalEntries = [];
  let status = null;

  const errors = {};

  if (researchRes.status === 'fulfilled') {
    if (researchRes.value && typeof researchRes.value === 'object' && !Array.isArray(researchRes.value)) {
      research = researchRes.value;
    } else {
      errors.research = 'invalid payload';
    }
  } else {
    errors.research = researchRes.reason instanceof Error ? researchRes.reason.message : String(researchRes.reason);
  }

  if (journalRes.status === 'fulfilled') {
    if (Array.isArray(journalRes.value)) {
      journalEntries = journalRes.value;
    } else {
      errors.journal = 'invalid payload';
    }
  } else {
    errors.journal = journalRes.reason instanceof Error ? journalRes.reason.message : String(journalRes.reason);
  }

  if (statusRes.status === 'fulfilled') {
    if (statusRes.value && typeof statusRes.value === 'object' && !Array.isArray(statusRes.value)) {
      status = statusRes.value;
    } else {
      errors.status = 'invalid payload';
    }
  } else {
    errors.status = statusRes.reason instanceof Error ? statusRes.reason.message : String(statusRes.reason);
  }

  if (!research && !status && !journalEntries.length) {
    throw new Error('Pi2 research endpoints unavailable');
  }

  const topPicks = Array.isArray(research?.top_picks) ? research.top_picks : [];
  const tradeLog = typeof status?.tradeLog === 'string' ? status.tradeLog : '';
  const pi2StrategyStatus =
    status && status.strategyStatus && typeof status.strategyStatus === 'object'
      ? status.strategyStatus
      : {};
  const pi2ServiceState = String(
    pi2StrategyStatus.alpaca_trader_service ||
      pi2StrategyStatus.alpacaTrader ||
      pi2StrategyStatus.alpaca_trader ||
      'unknown'
  ).toLowerCase();
  const pi2RuntimeStub = {
    services: {
      alpacaTrader: {
        active: pi2ServiceState
      }
    }
  };
  const pi2AutomatedTrades = buildAutomatedTradesFromResearch(research, [], [], pi2RuntimeStub);

  const payload = {
    generatedAt: nowIso(),
    sourceBaseUrl: PI2_ALT_BASE_URL,
    research,
    journalEntries,
    overviewTopPicks: topPicks.slice(0, 5),
    scannerCandidates: parseMorningScannerCandidates(tradeLog),
    account: parseAccountSnapshotFromTradeLog(tradeLog),
    automation: {
      active: ['active', 'running', 'online'].includes(pi2ServiceState),
      service:
        String(
          pi2StrategyStatus.alpaca_trader_service ||
            pi2StrategyStatus.alpacaTrader ||
            pi2StrategyStatus.alpaca_trader ||
            'unknown'
        ) || 'unknown',
      enabled: 'unknown',
      mode: 'unknown'
    },
    automatedTrades: pi2AutomatedTrades,
    strategyStatus: pi2StrategyStatus,
    openclaw: {
      pcOnline: status?.pcOnline ?? null,
      nextWake: status?.nextWake ?? '',
      updatedAt: status?.updatedAt ?? ''
    },
    errors
  };

  return payload;
}

async function generateTradingResearchSnapshot(force) {
  const cacheWindow =
    Number.isFinite(TRADING_RESEARCH_CACHE_MS) && TRADING_RESEARCH_CACHE_MS > 0
      ? TRADING_RESEARCH_CACHE_MS
      : 60_000;

  if (!force && tradingResearchCache.payload && Date.now() - tradingResearchCache.at < cacheWindow) {
    return tradingResearchCache.payload;
  }

  let payload = null;

  if (TRADING_RESEARCH_LOCAL_ONLY) {
    payload = await generateLocalTradingResearchSnapshot(force);
  } else {
    try {
      payload = await generateLocalTradingResearchSnapshot(force);
    } catch (localErr) {
      const fallback = await generatePi2TradingResearchSnapshot();
      const localMsg = localErr instanceof Error ? localErr.message : String(localErr);
      fallback.errors = { ...(fallback.errors || {}), local: localMsg };
      payload = fallback;
    }
  }

  tradingResearchCache = { at: Date.now(), payload };
  return payload;
}

async function getTradingResearchSnapshot(force) {
  const key = force ? 'force' : 'cache';

  const existing = inFlightTradingResearchByMode.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      return await generateTradingResearchSnapshot(force);
    } finally {
      inFlightTradingResearchByMode.delete(key);
    }
  })();

  inFlightTradingResearchByMode.set(key, p);
  return p;
}

const aiCliFeature = createAiCliFeature({
  DATA_DIR,
  AUDIO_DIR,
  DEFAULT_PERSONAS,
  ensureDir,
  nowIso,
  sendJson,
  jsonError,
  readBody,
  readEnvMap,
  callGemini,
  generateInworldAudio
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/ai-cli')) {
      const handled = await aiCliFeature.handleHttp(req, res, url);
      if (handled) return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, now: nowIso() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/bookmarks') {
      const { bookmarks, updatedAt } = readBookmarksFromDisk();
      sendJson(res, 200, { ok: true, bookmarks, updatedAt });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/bookmarks/update') {
      const raw = await readBody(req);
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        jsonError(res, 400, 'invalid json');
        return;
      }

      const normalized = normalizeBookmarksPayload(body);
      if (!normalized.ok) {
        const count = Number.isFinite(normalized.invalidRows) ? normalized.invalidRows : 0;
        jsonError(res, 400, count ? `invalid bookmarks (${count} invalid rows)` : normalized.error || 'invalid bookmarks');
        return;
      }

      writeBookmarksAtomic(normalized.bookmarks);
      sendJson(res, 200, { ok: true, saved: normalized.bookmarks.length, updatedAt: nowIso() });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/audio/')) {
      const name = safeAudioNameFromPath(url.pathname);
      if (!name) {
        jsonError(res, 400, 'invalid audio');
        return;
      }
      serveAudio(res, name);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/news') {
      const briefing = await getOrGenerateBriefing(false);
      sendJson(res, 200, briefing);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/news/refresh') {
      const briefing = await getOrGenerateBriefing(true);
      sendJson(res, 200, briefing);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/games/briefing') {
      const briefing = await getOrGenerateGameBriefing(false);
      sendJson(res, 200, briefing);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/games/briefing/refresh') {
      const briefing = await getOrGenerateGameBriefing(true);
      sendJson(res, 200, briefing);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/research-papers/briefing/history') {
      const periods = listResearchPaperBriefingHistory();
      sendJson(res, 200, {
        ok: true,
        periods,
        count: periods.length,
        dir: RESEARCH_PAPER_BRIEFINGS_DIR,
        now: nowIso()
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/research-papers/briefing') {
      const requested = normalizeMonthPeriod(url.searchParams.get('month'));
      const period = requested || localMonthString();
      const briefing = await getOrDoResearchPaperBriefing(period, 'get');
      sendJson(res, 200, briefing);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/research-papers/briefing/refresh') {
      const requested = normalizeMonthPeriod(url.searchParams.get('month'));
      const current = localMonthString();
      if (requested && requested !== current) {
        jsonError(res, 400, 'refresh only allowed for current month');
        return;
      }
      const period = requested || current;
      const briefing = await getOrDoResearchPaperBriefing(period, 'refresh');
      sendJson(res, 200, briefing);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/podcast-videos') {
      const playlist = await getOrGeneratePodcastVideos(false);
      sendJson(res, 200, playlist);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/podcast-videos/refresh') {
      const playlist = await getOrGeneratePodcastVideos(true);
      sendJson(res, 200, playlist);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/trading/status') {
      const env = readEnvMap();
      const [account, runtime] = await Promise.all([
        fetchAlpacaTradingStatus(env),
        Promise.resolve(readTradingRuntimeStatus())
      ]);

      const payload = {
        botRunning: runtime.services.alpacaTrader.active === 'active',
        cash: account.cash,
        equity: account.equity,
        dayPL: account.dayPL,
        positions: account.positions,
        lastUpdate: nowIso(),
        services: runtime.services,
        cron: runtime.cron
      };

      if (account.error && payload.cash == null && payload.equity == null) {
        payload.error = account.error;
      }

      sendJson(res, 200, payload);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/trading-research') {
      const snapshot = await getTradingResearchSnapshot(false);
      sendJson(res, 200, snapshot);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/trading-research/refresh') {
      const snapshot = await getTradingResearchSnapshot(true);
      sendJson(res, 200, snapshot);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/config/env') {
      const values = readEnvMap();
      sendJson(res, 200, { ok: true, values, updatedAt: nowIso(), envPath: ENV_PATH });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/config/env/update') {
      const raw = await readBody(req);
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        jsonError(res, 400, 'invalid json');
        return;
      }

      const setObj = body && typeof body === 'object' ? body.set : null;
      if (!setObj || typeof setObj !== 'object') {
        jsonError(res, 400, 'missing set');
        return;
      }

      const current = readEnvMap();
      const changed = [];

      for (const [k, v] of Object.entries(setObj)) {
        if (!isValidKeyName(k)) continue;

        if (v == null) {
          if (k in current) {
            delete current[k];
            changed.push(k);
          }
          continue;
        }

        if (typeof v !== 'string') continue;
        const vv = v.trim();
        if (!vv) continue;
        current[k] = vv;
        changed.push(k);
      }

      writeEnvMapAtomic(current);
      sendJson(res, 200, { ok: true, changed: Array.from(new Set(changed)).sort() });
      return;
    }

    jsonError(res, 404, 'not found');
  } catch (e) {
    jsonError(res, 500, e instanceof Error ? e.message : String(e));
  }
});

server.on('upgrade', (req, socket, head) => {
  try {
    if (aiCliFeature.handleUpgrade(req, socket, head)) return;
  } catch {
    // ignore and fall through to destroy the socket
  }

  try {
    socket.destroy();
  } catch {
    // ignore
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `[pi5-dashboard-api] listening on http://${HOST}:${PORT} (env: ${ENV_PATH}, data: ${DATA_DIR})`
  );
});
