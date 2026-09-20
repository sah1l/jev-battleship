// Shared by the page (backup brain) and the server (mock mode).
// board: 64 chars, '.' untested, 'o' miss, 'x' unsunk hit, '#' sunk. Returns 64 probabilities.
export const N = 8;

export function density(board, remaining, hitWeight = 40) {
  const totalHits = [...board].filter(ch => ch === 'x').length;
  let placements = [];
  for (const len of remaining) {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          if (r + dr * (len - 1) >= N || c + dc * (len - 1) >= N) continue;
          const cells = [];
          let hits = 0, blocked = false;
          for (let k = 0; k < len; k++) {
            const i = (r + dr * k) * N + (c + dc * k);
            const ch = board[i];
            if (ch === 'o' || ch === '#') { blocked = true; break; }
            if (ch === 'x') hits++;
            cells.push(i);
          }
          if (blocked || hits === len) continue;
          placements.push({ cells, hits });
        }
      }
    }
  }
  // With one ship left, every unsunk hit belongs to it, so its placement must cover them all.
  if (remaining.length === 1 && totalHits > 0) {
    const exact = placements.filter(p => p.hits === totalHits);
    if (!exact.length) throw new Error('No remaining ship placement covers all unsunk hits');
    placements = exact;
  }
  const w = new Array(N * N).fill(0);
  for (const { cells, hits } of placements) {
    const weight = Math.pow(hitWeight, hits);
    for (const i of cells) if (board[i] === '.') w[i] += weight;
  }
  let sum = w.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    for (let i = 0; i < w.length; i++) if (board[i] === '.') { w[i] = 1; sum++; }
  }
  return w.map(v => v / sum);
}
