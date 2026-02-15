#!/usr/bin/env node

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOST = process.env.PI5_DASHBOARD_API_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PI5_DASHBOARD_API_PORT || '8092', 10);
const ENV_PATH =
  process.env.PI5_DASHBOARD_ENV_PATH || path.join(os.homedir(), '.pi5-dashboard.keys.env');

const DATA_DIR =
  process.env.PI5_DASHBOARD_DATA_DIR || path.join(os.homedir(), '.pi5-dashboard-data');
const BRIEFINGS_DIR = path.join(DATA_DIR, 'briefings');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');

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
  {
    name: 'ARIA',
    voiceId: 'Ashley',
    personality:
      'You are ARIA, an AI news anchor. You are concise, technically fluent, and slightly witty. Avoid hype. Explain key context clearly.'
  },
  {
    name: 'The Analyst',
    voiceId: 'Ashley',
    personality:
      'You are a calm markets-and-tech analyst. You speak in short paragraphs with pragmatic takeaways and risk framing. No fluff.'
  },
  {
    name: 'Chaos Anchor',
    voiceId: 'Ashley',
    personality:
      'You are an energetic news anchor. You are punchy, playful, and fast. Still accurate and not misleading.'
  }
];

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

function stripHtml(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
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

async function callGemini(geminiApiKey, prompt) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

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

async function generateInworldAudio(inworldApiKey, inworldSecret, voiceId, text) {
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

  const filename = `news-summary-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.mp3`;
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, now: nowIso() });
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

server.listen(PORT, HOST, () => {
  console.log(
    `[pi5-dashboard-api] listening on http://${HOST}:${PORT} (env: ${ENV_PATH}, data: ${DATA_DIR})`
  );
});
