// Offline grading of saved probe games. Nothing here enters a Jev request or shot selection.
// node tuning/analyze.mjs tuning/baseline-games.json [--examples 6]
import { readFileSync } from 'node:fs';
import { density, N } from '../public/density.js';

const ROWS = 'ABCDEFGH';
const index = l => ROWS.indexOf(l[0]) * N + Number(l.slice(1)) - 1;
const label = i => ROWS[Math.floor(i / N)] + (i % N + 1);
const args = process.argv.slice(2);
const examples = args.includes('--examples') ? Number(args[args.indexOf('--examples') + 1]) : 0;
const files = args.filter((a, k) => !a.startsWith('--') && args[k - 1] !== '--examples');
const neighbours = i => [[-1, 0], [1, 0], [0, -1], [0, 1]].flatMap(([dr, dc]) => {
  const r = Math.floor(i / N) + dr, c = i % N + dc;
  return r >= 0 && r < N && c >= 0 && c < N ? [r * N + c] : [];
});
export const show = (board, mark) => Array.from({ length: N }, (_, r) =>
  ROWS[r] + ' ' + [...board.slice(r * N, r * N + N)].map((ch, c) => r * N + c === mark ? '*' : ch).join(' ')).join('\n');

// Inline extension cells: untested ends of a straight run of 2+ unsunk hits.
function lineEnds(board) {
  const ends = new Set();
  for (let i = 0; i < 64; i++) if (board[i] === 'x') for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const r = Math.floor(i / N), c = i % N;
    const pr = r - dr, pc = c - dc;
    if (pr >= 0 && pc >= 0 && board[pr * N + pc] === 'x') continue; // not the run's start
    let k = 1;
    while (r + dr * k < N && c + dc * k < N && board[(r + dr * k) * N + c + dc * k] === 'x') k++;
    if (k < 2) continue;
    if (pr >= 0 && pc >= 0 && board[pr * N + pc] === '.') ends.add(pr * N + pc);
    const er = r + dr * k, ec = c + dc * k;
    if (er < N && ec < N && board[er * N + ec] === '.') ends.add(er * N + ec);
  }
  return ends;
}

for (const file of files) {
  const run = JSON.parse(readFileSync(file, 'utf8'));
  const s = { games: run.records.length, shots: run.records.map(r => r.jevShots), density: run.records.map(r => r.densityShots),
    target: 0, targetAdjacent: 0, lineCases: 0, lineFollowed: 0, hunt: 0, huntImpossible: 0, huntRankSum: 0,
    targetRankSum: 0, confidenceSum: 0, turns: 0 };
  const bad = [];
  for (const rec of run.records) for (const t of rec.turns ?? []) {
    const i = index(t.choice), d = density(t.board, t.remaining);
    const rank = d.filter(v => v > d[i]).length + 1;
    s.turns++; s.confidenceSum += t.confidence;
    if (t.board.includes('x')) {
      s.target++; s.targetRankSum += rank;
      const adjacent = neighbours(i).some(n => t.board[n] === 'x');
      if (adjacent) s.targetAdjacent++;
      const ends = lineEnds(t.board);
      if (ends.size) { s.lineCases++; if (ends.has(i)) s.lineFollowed++; }
      if (!adjacent || d[i] === 0) bad.push({ kind: adjacent ? 'target-impossible' : 'target-ignored-hit', game: rec.game, ...t });
    } else {
      s.hunt++; s.huntRankSum += rank;
      if (d[i] === 0) { s.huntImpossible++; bad.push({ kind: 'hunt-impossible', game: rec.game, ...t }); }
    }
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`\n=== ${file}`);
  console.log(JSON.stringify({
    games: s.games, meanShots: +avg(s.shots).toFixed(2), shots: s.shots, densityMean: +avg(s.density).toFixed(2),
    targetTurns: s.target, targetAdjacentPct: Math.round(s.targetAdjacent / s.target * 100),
    lineFollowed: `${s.lineFollowed}/${s.lineCases}`,
    huntTurns: s.hunt, huntImpossiblePct: Math.round(s.huntImpossible / s.hunt * 100),
    meanDensityRankTarget: +(s.targetRankSum / s.target).toFixed(1), meanDensityRankHunt: +(s.huntRankSum / s.hunt).toFixed(1),
    meanConfidence: +(s.confidenceSum / s.turns).toFixed(3),
  }, null, 1));
  for (const b of bad.slice(0, examples)) {
    const top = Object.entries(b.probabilities).sort((a, c) => c[1] - a[1]).slice(0, 6).map(([l, p]) => `${l}(${b.board[index(l)]}) ${p.toFixed(3)}`).join('  ');
    console.log(`\n[${b.kind}] game ${b.game} turn ${b.turn} remaining ${JSON.stringify(b.remaining)} chose ${b.choice} (*)\n${show(b.board, index(b.choice))}\ntop: ${top}`);
  }
}
