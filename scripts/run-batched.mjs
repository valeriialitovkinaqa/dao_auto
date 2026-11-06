#!/usr/bin/env node
/**
 * Runs Playwright in small batches with a long gap between them, so the live store's rate limit
 * (HTTP 429 / Cloudflare bot check) is not hit. It does NOT bypass the bot check: on a challenge it waits
 * and retries the same batch once, then stops.
 *
 * Usage:
 *   node scripts/run-batched.mjs [options] <batch> [<batch> …]
 *   <batch> = a spec file, optionally with a test-title filter after "::"
 *             e.g. tests/pages/pdp_DE.spec.ts  or  "tests/pages/pdp.spec.ts::GB / en"
 * Options:
 *   --repeat N          rounds over all batches (default 1)
 *   --gap MIN           minutes to wait between batches (default 10)
 *   --challenge-wait M  minutes to wait after a Cloudflare challenge before retrying the batch once (default 45)
 *   --project NAME      Playwright project (default chromium)
 *   --pause MS          TEST_PAUSE_MS for every test (default 3000)
 *   --dry               only list the tests of every batch (playwright --list), no gaps — checks the setup without touching the store
 *
 * Output (both folders are git-ignored), one folder per run:
 *   playwright-report/batches/<run>/<batch>-r<round>.log   — plain-text log of every batch
 *   playwright-report/batches/<run>/<batch>-r<round>/      — HTML report of every batch
 *   test-results/batches/<run>/<batch>-r<round>/           — traces, screenshots, videos
 *   playwright-report/batches/<run>/summary.md             — table: passed / failed / challenge per batch
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = { repeat: 1, gap: 10, challengeWait: 45, project: 'chromium', pause: '3000', dry: false };
const batches = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--repeat') opt.repeat = Number(args[++i]);
  else if (a === '--gap') opt.gap = Number(args[++i]);
  else if (a === '--challenge-wait') opt.challengeWait = Number(args[++i]);
  else if (a === '--project') opt.project = args[++i];
  else if (a === '--pause') opt.pause = args[++i];
  else if (a === '--dry') opt.dry = true;
  else batches.push(a);
}
if (!batches.length) {
  console.error('Give at least one batch, e.g.: node scripts/run-batched.mjs --repeat 3 tests/pages/pdp_DE.spec.ts');
  process.exit(2);
}

const d = new Date();
const pad = (x) => String(x).padStart(2, '0');
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`; // local time
const reportRoot = join('playwright-report', 'batches', stamp);
const resultsRoot = join('test-results', 'batches', stamp);
mkdirSync(reportRoot, { recursive: true });
const ANSI = /\x1b\[[0-9;]*m/g;
const sleep = (min) => new Promise((r) => setTimeout(r, opt.dry ? 0 : min * 60_000));
const now = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const slug = (b) => b.replace(/^tests\//, '').replace(/\.spec\.ts/, '').replace(/::/, '-').replace(/[^\w-]+/g, '_');

function runBatch(batch, name) {
  const [file, grep] = batch.split('::');
  const cmd = ['playwright', 'test', file, `--project=${opt.project}`, `--output=${join(resultsRoot, name)}`];
  if (grep) cmd.push('-g', grep);
  if (opt.dry) cmd.push('--list');
  const logFile = join(reportRoot, `${name}.log`);
  writeFileSync(logFile, `$ npx ${cmd.join(' ')}\n\n`);
  return new Promise((resolve) => {
    const child = spawn('npx', cmd, {
      env: { ...process.env, TEST_PAUSE_MS: opt.pause, FORCE_COLOR: '1', PLAYWRIGHT_HTML_OUTPUT_DIR: join(reportRoot, name) },
    });
    let out = '';
    const onData = (d) => {
      process.stdout.write(d);
      const plain = d.toString().replace(ANSI, '');
      out += plain;
      appendFileSync(logFile, plain);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      const num = (re) => Number(out.match(re)?.[1] ?? 0);
      resolve({
        code,
        passed: opt.dry ? num(/Total: (\d+) test/) : num(/(\d+) passed/),
        failed: num(/(\d+) failed/),
        challenged: /BotChallengeError|RateLimitError/.test(out),
        logFile,
      });
    });
  });
}

const summary = [];
const total = opt.repeat * batches.length;
let n = 0;
console.log(`Batched run ${stamp}: ${batches.length} batch(es) × ${opt.repeat} round(s), gap ${opt.gap} min, reports in ${reportRoot}\n`);
outer: for (let round = 1; round <= opt.repeat; round++) {
  for (const batch of batches) {
    n++;
    const name = `${slug(batch)}-r${round}`;
    console.log(`\n=== [${now()}] ${n}/${total} ${batch} (round ${round}) ===\n`);
    let res = await runBatch(batch, name);
    if (res.challenged) {
      console.log(`\n[${now()}] Cloudflare / rate limit hit — waiting ${opt.challengeWait} min, then retrying this batch once.`);
      await sleep(opt.challengeWait);
      res = await runBatch(batch, `${name}-retry`);
      if (res.challenged) {
        summary.push({ batch, round, ...res, note: 'still blocked after the wait — run stopped' });
        console.log(`\n[${now()}] Still blocked after the wait. Stopping; try again later or from another environment.`);
        break outer;
      }
      res.note = 'passed the batch after waiting out a challenge';
    }
    summary.push({ batch, round, ...res });
    if (n < total) {
      console.log(`\n[${now()}] Waiting ${opt.gap} min before the next batch…`);
      await sleep(opt.gap);
    }
  }
}

const table = [
  `# Batched run ${stamp}`,
  '',
  '| Round | Batch | Passed | Failed | Cloudflare / 429 | Log | Note |',
  '|---|---|---|---|---|---|---|',
  ...summary.map((s) => `| ${s.round} | ${s.batch} | ${s.passed} | ${s.failed} | ${s.challenged ? 'yes' : 'no'} | ${s.logFile} | ${s.note || ''} |`),
].join('\n');
writeFileSync(join(reportRoot, 'summary.md'), table + '\n');
console.log(`\n${table}\n\nSummary: ${join(reportRoot, 'summary.md')}`);
process.exit(summary.some((s) => s.failed || s.challenged) ? 1 : 0);
