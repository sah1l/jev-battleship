// Offline test fixtures and answer key. None of the grading data enters prompts.
export const ROWS = 'ABCDEFGH';
export const cell = i => ROWS[Math.floor(i / 8)] + (i % 8 + 1);
export const index = label => ROWS.indexOf(label[0]) * 8 + Number(label.slice(1)) - 1;
export function rotate(i, turns) {
  let r = Math.floor(i / 8), c = i % 8;
  for (let n = 0; n < turns; n++) [r, c] = [c, 7 - r];
  return r * 8 + c;
}
export function answerKey(board, remaining) {
  if (remaining.length !== 1) throw new Error('This diagnostic grades only single remaining ship positions');
  const len = remaining[0], hits = [...board].flatMap((ch, i) => ch === 'x' ? [i] : []);
  const placements = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
    if (r + dr * (len - 1) >= 8 || c + dc * (len - 1) >= 8) continue;
    const cells = Array.from({ length: len }, (_, k) => (r + dr * k) * 8 + c + dc * k);
    if (cells.some(i => 'o#'.includes(board[i])) || !hits.every(i => cells.includes(i)) || !cells.some(i => board[i] === '.')) continue;
    placements.push(cells);
  }
  if (!placements.length) throw new Error('Inconsistent fixture');
  const counts = Array(64).fill(0);
  placements.forEach(p => p.forEach(i => { if (board[i] === '.') counts[i]++; }));
  const best = Math.max(...counts);
  const acceptable = counts.flatMap((n, i) => n === best ? [cell(i)] : []);
  // Each test has either one legal placement, or equally good cells at the two ends.
  if (counts.some(n => n > 0 && n < best)) throw new Error('Fixture requires probabilistic strategy grading');
  return { acceptable, placements: placements.map(p => p.map(cell)) };
}

const specifications = [
  { id: 'three-in-line', split: 'regression', title: 'Three hits in a straight line', len: 4, hits: ['B6', 'C6', 'D6'], misses: [], sunk: [['A1','A2','A3'],['C1','C2','C3'],['E1','E2']] },
  { id: 'blocked-end', split: 'new', title: 'One end is already a miss', len: 3, hits: ['C5', 'D5'], misses: ['B5'], sunk: [['A1','A2','A3','A4'],['C1','C2','C3'],['F1','F2']] },
  { id: 'middle-gap', split: 'new', title: 'The missing middle segment', len: 3, hits: ['F4', 'F6'], misses: [], sunk: [['A1','A2','A3','A4'],['C1','C2','C3'],['H1','H2']] },
  { id: 'two-cell-finish', split: 'new', title: 'Finish the last two-cell ship', len: 2, hits: ['G7'], misses: ['F7','G6','G8'], sunk: [['A1','A2','A3','A4'],['C1','C2','C3'],['E1','E2','E3']] },
];
export const fixtures = specifications.flatMap(spec => Array.from({ length: 4 }, (_, turns) => {
  const board = Array(64).fill('.');
  for (const group of spec.sunk) for (const c of group) board[rotate(index(c), turns)] = '#';
  for (const c of spec.hits) board[rotate(index(c), turns)] = 'x';
  for (const c of spec.misses) board[rotate(index(c), turns)] = 'o';
  const state = board.join('');
  return { id: `${spec.id}-r${turns * 90}`, family: spec.id, split: spec.split, title: spec.title,
    rotation: turns * 90, board: state, remaining: [spec.len], ...answerKey(state, [spec.len]) };
}));
