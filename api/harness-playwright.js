'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let playwright = null;
try {
  playwright = require('playwright-core');
} catch {
  playwright = null;
}

function slugify(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'scenario';
}

function chromiumCandidates() {
  return [
    process.env.HARNESS_CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/snap/bin/chromium'
  ].filter(Boolean);
}

function detectChromiumPath() {
  for (const p of chromiumCandidates()) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return '';
}

function chromiumVersion(executablePath) {
  const bin = String(executablePath || '').trim();
  if (!bin) return '';
  try {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
    return `${r.stdout || ''}${r.stderr || ''}`.trim();
  } catch {
    return '';
  }
}

function detectPlaywright() {
  const chromiumPath = detectChromiumPath();
  const installed = Boolean(playwright && playwright.chromium);
  return {
    installed,
    chromiumPath: chromiumPath || null,
    chromiumVersion: chromiumVersion(chromiumPath) || null,
    ready: Boolean(installed && chromiumPath)
  };
}

function normalizeScenarios(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (!item || typeof item !== 'object') continue;
    const url = String(item.url || '').trim();
    if (!url) continue;
    const scenario = {
      name: String(item.name || `Scenario ${i + 1}`).trim() || `Scenario ${i + 1}`,
      url,
      waitForSelector: String(item.waitForSelector || '').trim(),
      waitForText: String(item.waitForText || '').trim(),
      clickSelectors: Array.isArray(item.clickSelectors)
        ? item.clickSelectors.map((v) => String(v || '').trim()).filter(Boolean)
        : [],
      fill: Array.isArray(item.fill)
        ? item.fill
            .map((row) => ({
              selector: String(row && row.selector ? row.selector : '').trim(),
              value: String(row && row.value ? row.value : '')
            }))
            .filter((row) => row.selector)
        : [],
      screenshotName: String(item.screenshotName || '').trim(),
      timeoutMs: Number.isFinite(Number(item.timeoutMs)) ? Math.max(1000, Math.min(60000, Number(item.timeoutMs))) : 15000
    };
    out.push(scenario);
  }
  return out;
}

async function runBrowserValidation(options) {
  const {
    scenarios,
    artifactDir,
    log = () => {},
    nowIso = () => new Date().toISOString()
  } = options || {};

  const dep = detectPlaywright();
  if (!dep.installed) {
    throw new Error('playwright-core is not installed');
  }
  if (!dep.chromiumPath) {
    throw new Error('Chromium executable not found');
  }

  const normalized = normalizeScenarios(scenarios);
  if (!normalized.length) {
    return { ok: true, ran: false, results: [], errors: [], screenshots: [] };
  }

  fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });

  let browser = null;
  const results = [];
  const errors = [];
  const screenshots = [];

  try {
    log(`[browser] launching Chromium: ${dep.chromiumPath}`);
    browser = await playwright.chromium.launch({
      headless: true,
      executablePath: dep.chromiumPath,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });

    for (let i = 0; i < normalized.length; i += 1) {
      const s = normalized[i];
      const page = await browser.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', (err) => {
        pageErrors.push(err && err.message ? err.message : String(err));
      });

      const startedAt = nowIso();
      const baseShot = s.screenshotName ? slugify(s.screenshotName) : `${String(i + 1).padStart(2, '0')}-${slugify(s.name)}`;
      const shotFile = path.join(artifactDir, `browser-${baseShot}.png`);

      try {
        log(`[browser] [${i + 1}/${normalized.length}] goto ${s.url}`);
        await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: s.timeoutMs });
        await page.waitForTimeout(500);

        if (s.waitForSelector) {
          log(`[browser] waitForSelector ${s.waitForSelector}`);
          await page.waitForSelector(s.waitForSelector, { timeout: s.timeoutMs });
        }

        if (s.waitForText) {
          log(`[browser] waitForText ${s.waitForText}`);
          await page.getByText(s.waitForText, { exact: false }).first().waitFor({ timeout: s.timeoutMs });
        }

        for (const fillRow of s.fill) {
          log(`[browser] fill ${fillRow.selector}`);
          await page.fill(fillRow.selector, fillRow.value, { timeout: s.timeoutMs });
        }

        for (const selector of s.clickSelectors) {
          log(`[browser] click ${selector}`);
          await page.click(selector, { timeout: s.timeoutMs });
          await page.waitForTimeout(250);
        }

        await page.screenshot({ path: shotFile, fullPage: true });
        screenshots.push(shotFile);
        log(`[browser] screenshot saved ${path.basename(shotFile)}`);

        results.push({
          name: s.name,
          url: s.url,
          ok: true,
          startedAt,
          finishedAt: nowIso(),
          title: await page.title().catch(() => ''),
          finalUrl: page.url(),
          screenshot: path.basename(shotFile),
          consoleErrors,
          pageErrors
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ name: s.name, url: s.url, error: msg });
        log(`[browser] ERROR ${s.name}: ${msg}`);
        try {
          await page.screenshot({ path: shotFile, fullPage: true });
          screenshots.push(shotFile);
        } catch {
          // ignore screenshot failure on error path
        }
        results.push({
          name: s.name,
          url: s.url,
          ok: false,
          startedAt,
          finishedAt: nowIso(),
          error: msg,
          screenshot: fs.existsSync(shotFile) ? path.basename(shotFile) : null,
          consoleErrors,
          pageErrors
        });
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return {
    ok: errors.length === 0,
    ran: true,
    results,
    errors,
    screenshots: screenshots.map((f) => path.basename(f)),
    environment: dep
  };
}

module.exports = {
  detectPlaywright,
  normalizeScenarios,
  runBrowserValidation
};
