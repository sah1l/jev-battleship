// Probe adapter: VARIANT=open-water node probe.mjs 8 --request-module ./tuning/variant-shot.mjs
import { buildVariant } from './variants.mjs';
const N = 8, ROWS = 'ABCDEFGH';
const name = process.env.VARIANT || 'production';
export const buildRequest = (board, remaining, options) => buildVariant(board, remaining, name, options);
// Highest-probability legal cell among the options that were offered.
export function selectShot(board, probabilities) {
  let target = null, best = -1;
  for (let i = 0; i < N * N; i++) {
    const cell = ROWS[Math.floor(i / N)] + (i % N + 1), p = probabilities?.[cell];
    if (board[i] !== '.' || typeof p !== 'number' || !Number.isFinite(p)) continue;
    if (p > best) { target = cell; best = p; }
  }
  if (target === null) throw new Error('No probability for an untested cell');
  return { choice: target, confidence: best };
}
