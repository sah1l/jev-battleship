// Late hunt positions taken from saved games. node tuning/endgame.mjs near-far,near-far-end
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { readFileSync } from 'node:fs';
import { buildVariant } from './variants.mjs';
import { selectShot } from './variant-shot.mjs';
import { density } from '../public/density.js';
try { process.loadEnvFile(); } catch {}
const client = new TypeSafeClient({ timeout: 10000, retry: { maxRetries: 2 } });
const index = l => 'ABCDEFGH'.indexOf(l[0]) * 8 + Number(l.slice(1)) - 1;
const seeded = v => () => { v = (Math.imul(v, 1664525) + 1013904223) >>> 0; return v / 4294967296; };
const turns = ['final-near-far', 'final-neighbours', 'holdout-near-far'].flatMap(f =>
  JSON.parse(readFileSync(`tuning/${f}-games.json`, 'utf8')).records.flatMap(r => r.turns))
  .filter(t => !t.board.includes('x') && t.turn >= 24);
const cases = turns.filter((_, k) => k % Math.ceil(turns.length / 40) === 0);
console.log(`${cases.length} late hunt positions`);
for (const variant of process.argv[2].split(',')) {
  let quality = 0, zero = 0;
  await Promise.all(cases.map(async (c, k) => {
    const result = await client.systemOne(buildVariant(c.board, c.remaining, variant, { random: seeded(99 + k * 101) }));
    const i = index(selectShot(c.board, result.answers.shot.probabilities).choice), d = density(c.board, c.remaining);
    quality += d[i] / Math.max(...d); if (!d[i]) zero++;
  }));
  console.log(variant, 'quality', (quality / cases.length).toFixed(2), 'impossible', `${zero}/${cases.length}`);
}
