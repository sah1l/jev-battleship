// Live position diagnostic. node tuning/positions.mjs production,open-water tuning/positions-1.json
// Grading (density, fixtures) is offline only and never enters a request.
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { writeFileSync } from 'node:fs';
import { buildVariant } from './variants.mjs';
import { selectShot } from './variant-shot.mjs';
import { density, N } from '../public/density.js';
import { fixtures } from './fixtures.mjs';
try { process.loadEnvFile(); } catch {}
const client = new TypeSafeClient({ timeout: 10000, retry: { maxRetries: 2 } });
const ROWS = 'ABCDEFGH', FLEET = [4, 3, 3, 2];
const index = l => ROWS.indexOf(l[0]) * N + Number(l.slice(1)) - 1;
const seeded = v => () => { v = (Math.imul(v, 1664525) + 1013904223) >>> 0; return v / 4294967296; };

function placeFleet(random) {
  const taken = new Set();
  return FLEET.map(len => { for (;;) {
    const across = random() < .5;
    const r = Math.floor(random() * (across ? N : N - len + 1)), c = Math.floor(random() * (across ? N - len + 1 : N));
    const cells = Array.from({ length: len }, (_, k) => (r + (across ? 0 : k)) * N + c + (across ? k : 0));
    if (cells.some(i => taken.has(i))) continue;
    cells.forEach(i => taken.add(i));
    return { len, cells, hits: 0 };
  } });
}
// Boards reached by a noisy but sensible player, so positions look like real games.
export function snapshots(seed, games) {
  const hunt = [], target = [];
  for (let g = 0; g < games; g++) {
    const random = seeded(seed + g * 7919), ships = placeFleet(random), board = Array(64).fill('.');
    for (let turn = 0; ships.some(s => s.hits < s.len); turn++) {
      const remaining = ships.filter(s => s.hits < s.len).map(s => s.len), b = board.join('');
      const d = density(b, remaining);
      (b.includes('x') ? target : hunt).push({ id: `g${g}t${turn}`, board: b, remaining, turn });
      let roll = random() * d.reduce((x, y) => x + y * y, 0), i = 0;
      for (; i < 64; i++) { roll -= d[i] * d[i]; if (roll <= 0) break; }
      i = Math.min(i, 63); if (board[i] !== '.') i = d.indexOf(Math.max(...d));
      const ship = ships.find(s => s.cells.includes(i));
      if (!ship) { board[i] = 'o'; continue; }
      ship.hits++; board[i] = 'x';
      if (ship.hits === ship.len) ship.cells.forEach(c => { board[c] = '#'; });
    }
  }
  return { hunt, target };
}
const pickEvery = (a, n) => a.filter((_, k) => k % Math.ceil(a.length / n) === 0).slice(0, n);

if (process.argv[1]?.endsWith('positions.mjs')) {
  const variants = process.argv[2].split(','), out = process.argv[3];
  const seed = Number(process.argv[4] || 4242);
  const { hunt, target } = snapshots(seed, 10);
  const cases = [...pickEvery(hunt, 20).map(c => ({ ...c, kind: 'hunt' })), ...pickEvery(target, 12).map(c => ({ ...c, kind: 'target' })),
    ...fixtures.map(f => ({ id: f.id, board: f.board, remaining: f.remaining, acceptable: f.acceptable, kind: 'tactical' }))];
  const records = [];
  await Promise.all(variants.map(async variant => {
    for (const [k, c] of cases.entries()) {
      const request = buildVariant(c.board, c.remaining, variant, { random: seeded(seed + k * 101) });
      const result = await client.systemOne(request);
      const probabilities = result.answers.shot.probabilities, sel = selectShot(c.board, probabilities);
      const i = index(sel.choice), d = density(c.board, c.remaining), max = Math.max(...d);
      const near = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dr, dc]) => [Math.floor(i / N) + dr, i % N + dc])
        .filter(([r, cc]) => r >= 0 && r < N && cc >= 0 && cc < N).map(([r, cc]) => c.board[r * N + cc]);
      records.push({ variant, id: c.id, kind: c.kind, board: c.board, remaining: c.remaining, ...sel,
        quality: d[i] / max, rank: d.filter(v => v > d[i]).length + 1, nextToHit: near.includes('x'), nextToFired: near.some(ch => ch !== '.'),
        correct: c.acceptable ? c.acceptable.includes(sel.choice) : null, tokens: result.usage?.input_tokens, probabilities });
    }
  }));
  if (out) writeFileSync(out, JSON.stringify({ seed, records }, null, 1) + '\n');
  const avg = a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null;
  console.table(variants.map(v => {
    const r = records.filter(x => x.variant === v), of = k => r.filter(x => x.kind === k);
    return { variant: v, huntQuality: avg(of('hunt').map(x => x.quality)), huntRank: avg(of('hunt').map(x => x.rank)),
      huntZero: of('hunt').filter(x => x.quality === 0).length, huntNextToFired: of('hunt').filter(x => x.nextToFired).length + '/' + of('hunt').length,
      targetQuality: avg(of('target').map(x => x.quality)), targetNextToHit: of('target').filter(x => x.nextToHit).length + '/' + of('target').length,
      tactical: of('tactical').filter(x => x.correct).length + '/16', tokens: avg(r.map(x => x.tokens)) };
  }));
}
