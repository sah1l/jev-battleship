// Live gameplay probe. The optional seed makes fleets and option ordering reproducible.
// npm run probe -- 8 --seed 20260920 --out prompt-experiment/after-games.json
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { selectShot } from './api/shot.js';
import { density, N } from './public/density.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

try { process.loadEnvFile(); } catch {}
if (!process.env.TYPESAFE_API_KEY) throw new Error('Set TYPESAFE_API_KEY in .env first.');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const games = Number(args[0] && !args[0].startsWith('--') ? args[0] : 3);
const seed = Number(option('--seed', Date.now() >>> 0));
if (!Number.isInteger(games) || games < 1 || !Number.isInteger(seed)) throw new Error('Invalid game count or seed');
const requestModule = option('--request-module', './api/shot.js');
const { buildRequest, selectShot: moduleSelectShot } = await import(pathToFileURL(resolve(requestModule)).href);
const pickShot = moduleSelectShot ?? selectShot;
const out = option('--out', null);
const FLEET = [4, 3, 3, 2], ROWS = 'ABCDEFGH';
const client = new TypeSafeClient({ timeout: 10000, retry: { maxRetries: 1 } });
const seeded = value => () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
const average = a => a.reduce((x, y) => x + y, 0) / a.length;
const report = { seed, games, requestModule, startedAt: new Date().toISOString(),
  note: 'The same seed and game count give identical hidden fleets and per-turn option order across prompts. Only observed board and remaining lengths enter Jev requests. Density is an offline comparison, never a Jev input or fallback.', records: [] };
function save() {
  if (!out) return;
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
}
function placeFleet(random) {
  const taken = new Set();
  return FLEET.map(len => {
    for (;;) {
      const across = random() < .5;
      const r = Math.floor(random() * (across ? N : N - len + 1));
      const c = Math.floor(random() * (across ? N - len + 1 : N));
      const cells = Array.from({ length: len }, (_, k) => (r + (across ? 0 : k)) * N + c + (across ? k : 0));
      if (cells.some(i => taken.has(i))) continue;
      cells.forEach(i => taken.add(i));
      return { len, cells, hits: 0 };
    }
  });
}
async function play(fleet, pick) {
  const ships = structuredClone(fleet), board = Array(64).fill('.');
  let shots = 0;
  while (ships.some(s => s.hits < s.len)) {
    const i = await pick(board.join(''), ships.filter(s => s.hits < s.len).map(s => s.len), shots);
    if (!Number.isInteger(i) || board[i] !== '.') throw new Error(`Illegal move ${i}`);
    shots++;
    const ship = ships.find(s => s.cells.includes(i));
    if (!ship) { board[i] = 'o'; continue; }
    ship.hits++;
    board[i] = 'x';
    if (ship.hits === ship.len) ship.cells.forEach(c => { board[c] = '#'; });
  }
  return shots;
}
console.log(`Live Jev probe: ${games} identical seeded fleets; seed=${seed}; request=${requestModule}`);
for (let g = 0; g < games; g++) {
  const fleet = placeFleet(seeded(seed + g * 1009)), turns = [];
  const record = { game: g + 1, fleet, turns };
  report.records.push(record);
  record.jevShots = await play(fleet, async (board, remaining, turn) => {
    const request = buildRequest(board, remaining, { random: seeded(seed + g * 100003 + turn * 101) });
    const start = performance.now();
    const result = await client.systemOne(request);
    const probabilities = result.answers.shot.probabilities;
    const selected = pickShot(board, probabilities);
    const i = ROWS.indexOf(selected.choice[0]) * N + Number(selected.choice.slice(1)) - 1;
    const d = density(board, remaining);
    turns.push({ turn: turn + 1, board, remaining, ...selected, modelChoice: result.answers.shot.choice,
      probabilities, model: result.model, ms: Math.round(performance.now() - start),
      tokens: result.usage?.input_tokens || 0, densityAgreement: d[i] >= Math.max(...d) * .8 });
    save();
    if ((turn + 1) % 16 === 0) console.log(`  fleet ${g + 1}: ${turn + 1} shots, last ${selected.choice}`);
    return i;
  });
  record.densityShots = await play(fleet, async (board, remaining) => {
    const d = density(board, remaining);
    return d.indexOf(Math.max(...d));
  });
  const random = seeded(seed + g * 5003);
  record.randomShots = await play(fleet, async board => {
    const open = [...board].flatMap((ch, i) => ch === '.' ? [i] : []);
    return open[Math.floor(random() * open.length)];
  });
  console.log(`fleet ${g + 1}: Jev ${record.jevShots}, density ${record.densityShots}, random ${record.randomShots} shots`);
  save();
}
const turns = report.records.flatMap(r => r.turns), times = turns.map(t => t.ms).sort((a, b) => a - b);
report.summary = {
  jevAverageShots: average(report.records.map(r => r.jevShots)),
  densityAverageShots: average(report.records.map(r => r.densityShots)),
  randomAverageShots: average(report.records.map(r => r.randomShots)),
  calls: turns.length, medianMs: times[times.length >> 1], p95Ms: times[Math.floor(times.length * .95)],
  tokensPerMatch: Math.round(turns.reduce((s, t) => s + t.tokens, 0) / games),
  densityAgreementPercent: Math.round(turns.filter(t => t.densityAgreement).length / turns.length * 100),
};
report.finishedAt = new Date().toISOString();
save();
console.log('\nShots to clear a fleet (lower is stronger), paired on the same fleets');
console.log(JSON.stringify(report.summary, null, 2));
