// Prompt variants for live tuning. Each variant only changes how the observed board is
// presented and worded. No placement counts, scores, lattices or filtered targets.
import { choice } from '@typesafe-ai/sdk';
import { buildRequest as production } from '../api/shot.js';
// The prompt that was live before this tuning round, archived for paired reruns.
import { buildRequest as previous } from './previous-shot.mjs';

const N = 8, FLEET = [4, 3, 3, 2], ROWS = 'ABCDEFGH';
const label = i => ROWS[Math.floor(i / N)] + (i % N + 1);
const WORDS = { '.': 'need-to-check', o: 'miss', x: 'hit', '#': 'sunk' };
const RULES = 'Each ship is a straight, consecutive horizontal or vertical line of its stated length. Ships cannot overlap but may touch. Remaining ships cannot pass through miss or sunk cells. A ship is sunk only when all its cells are hit.';

export const INSTRUCTIONS = {
  // Two explicit cases, literal wording, no capitals.
  twoCase: 'Battleship: choose the next cell to fire at, to sink all remaining ships in as few shots as possible. ' +
    'Case 1: the board contains at least one hit cell. Choose a need-to-check cell directly next to a hit cell (same row or same column). If two or more hit cells form a line, choose the need-to-check cell that continues that line at either end. ' +
    'Case 2: the board contains no hit cell. Choose a need-to-check cell in the middle of the largest untouched area, far away from every miss cell and every sunk cell. Do not choose a cell next to a miss. Do not continue a row of misses.',
  // Same, but hunt phrased positively only (docs: negation and indirection hurt).
  openWater: 'Battleship: choose the next cell to fire at, to sink all remaining ships in as few shots as possible. ' +
    'If the board contains a hit cell, choose a need-to-check cell directly next to it, continuing the line when two or more hit cells are aligned. ' +
    'If the board contains no hit cell, choose a need-to-check cell surrounded by other need-to-check cells, in the largest untouched area of the board, as far as possible from all miss and sunk cells.',
  // Explains why, in case Jev benefits from the reason.
  reason: 'Battleship: choose the next cell to fire at, to sink all remaining ships in as few shots as possible. ' +
    'A hit cell is part of a ship that is still afloat: its other cells are directly next to it in the same row or column, so fire there, continuing the line when hit cells are aligned. ' +
    'When there is no hit cell, the remaining ships are hidden in untouched water. A long ship needs a long run of need-to-check cells, so fire into the middle of the biggest untouched area. A cell next to misses is a poor target because little room is left there for a ship. Spread shots apart, leaving gaps between them.',
  // Hit priority stated first and exclusively, then the reasoned hunt paragraph.
  hitFirst: 'Battleship: choose the next cell to fire at, to sink all remaining ships in as few shots as possible. ' +
    'First look for hit cells. A hit cell is part of a ship that is still afloat, and finishing that ship always comes first: its other cells are directly next to the hit in the same row or column. While any hit cell is on the board, the only good targets are need-to-check cells directly next to a hit cell, continuing the line when hit cells are aligned. ' +
    'Only when there is no hit cell anywhere: the remaining ships are hidden in untouched water. A long ship needs a long run of need-to-check cells, so fire into the middle of the biggest untouched area. A cell next to misses is a poor target because little room is left there for a ship. Spread shots apart, leaving gaps between them.',
  // Same idea, shorter.
  hitFirstShort: 'Battleship: choose the next cell to fire at, to sink all remaining ships in as few shots as possible. ' +
    'If any cell is hit, that ship is still afloat and its other cells are directly next to the hit, so choose a need-to-check cell next to a hit cell, continuing the line when hit cells are aligned. ' +
    'If no cell is hit, the ships are hidden in untouched water. A ship needs a long run of need-to-check cells, so fire into the middle of the biggest untouched area, away from misses, leaving gaps between shots.',
  look: 'Battleship: choose the next cell to fire at, to sink all remaining ships in as few shots as possible. Every option is a need-to-check cell, described by the cells seen from it going up, down, left and right, nearest first. ' +
    'Best target: an option where one direction starts with hit, hit. It continues a line of hits, so the ship very likely extends into it. ' +
    'Next best: an option where one direction starts with hit. It is directly next to a ship that is still afloat. ' +
    'Only when no option has a direction that starts with hit: choose an option that sees need-to-check in every direction, because ships are hidden in untouched water with room on all sides. Options that see miss, sunk or edge nearby have less room for a ship.',
  // Literal string matching for the hunt case.
  lookLiteral: 'Battleship: choose the next cell to fire at, to sink all remaining ships in as few shots as possible. Every option is a need-to-check cell, described by the two cells seen from it going up, down, left and right, nearest first. ' +
    'Best target: an option where a direction reads "hit, hit". It continues a line of hits. ' +
    'Next best: an option where a direction starts with "hit". It is directly next to a ship that is still afloat. ' +
    'Only when no option mentions hit at the start of a direction: choose an option where all four directions read "need-to-check, need-to-check". That is untouched water with room for a ship on every side. Avoid options that mention miss, sunk or edge.',
  // Two-cell look for targeting; hunt keyed to the nearest cell only, which produces spaced shots.
  lookNear: 'Battleship: choose the next cell to fire at, to sink all remaining ships in as few shots as possible. Every option is a need-to-check cell, described by the two cells seen from it going up, down, left and right, nearest first. ' +
    'Best target: an option where a direction reads "hit, hit". It continues a line of hits. ' +
    'Next best: an option where a direction starts with "hit". It is directly next to a ship that is still afloat. ' +
    'Only when no option has a direction that starts with "hit": choose an option where all four directions start with "need-to-check", so that none of its direct neighbours has been fired at. Avoid options where a direction starts with miss, sunk or edge.',
  lookNearWhy: 'Battleship: choose the next cell to fire at, to sink all remaining ships in as few shots as possible. Every option is a need-to-check cell, described by the two cells seen from it going up, down, left and right, nearest first. ' +
    'Best target: an option where a direction reads "hit, hit". It continues a line of hits, and ships are straight lines. ' +
    'Next best: an option where a direction starts with "hit". It is directly next to a ship that is still afloat. ' +
    'Only when no option has a direction that starts with "hit": search for the hidden ships. Choose an option where all four directions start with "need-to-check": none of its direct neighbours has been fired at, so a ship can pass through it in any direction. An option where a direction starts with miss, sunk or edge has less room for a ship and is a worse choice.',
  nearFar: 'Battleship: choose the next cell to fire at, to sink all remaining ships in as few shots as possible. Each option lists the state of its four neighbours, then the state of the cells one further in the same four directions. ' +
    'If any option has a hit neighbour, choose one of those. Best is an option where the same direction is hit both as neighbour and one further, for example "down hit" in both lists: it continues a line of hits. ' +
    'Otherwise choose an option whose neighbours are all need-to-check, in the largest untouched area. Avoid options with miss, sunk or edge neighbours.',
  nearFarEnd: 'Battleship: choose the next cell to fire at, to sink all remaining ships in as few shots as possible. Each option lists the state of its four neighbours, then the state of the cells one further in the same four directions. ' +
    'If any option has a hit neighbour, choose one of those. Best is an option where the same direction is hit both as neighbour and one further, for example "down hit" in both lists: it continues a line of hits. ' +
    'Otherwise choose an option whose neighbours are all need-to-check, in the largest untouched area. Avoid options with miss, sunk or edge neighbours. ' +
    'When every option has such a neighbour, choose the option with the most need-to-check neighbours. An option with no need-to-check neighbour cannot hold a ship: never choose it.',
  nearFarEnd2: 'Battleship: choose the next cell to fire at, to sink all remaining ships in as few shots as possible. Each option lists the state of its four neighbours, then the state of the cells one further in the same four directions. ' +
    'If any option has a hit neighbour, choose one of those. Best is an option where the same direction is hit both as neighbour and one further, for example "down hit" in both lists: it continues a line of hits. ' +
    'Otherwise choose an option whose neighbours are all need-to-check, in the largest untouched area. The more need-to-check neighbours an option has, the better: a ship needs need-to-check cells in a row. An option with no need-to-check neighbour cannot hold a ship.',
  // Neighbour wording with an added line rule, for one-cell neighbour descriptions plus the grid.
  neighboursLine: 'Battleship: choose the next cell to fire at, to sink all remaining ships in as few shots as possible. Each option lists the cell and the state of its four neighbours. ' +
    'If any option has a hit neighbour, choose one of those. When two or more hit cells form a line in the grid, choose the option at the end of that line, in the same row or column as the hits, not an option beside the line. ' +
    'Otherwise choose an option whose neighbours are all need-to-check, in the largest untouched area. Avoid options with miss, sunk or edge neighbours.',
  // Neighbour-aware wording for criteria that list each cell's four neighbours.
  neighbours: 'Battleship: choose the next cell to fire at, to sink all remaining ships in as few shots as possible. Each option lists the cell and the state of its four neighbours. ' +
    'If any option has a hit neighbour, choose one of those; best is an option where the hit neighbour continues a line of hits. ' +
    'Otherwise choose an option whose neighbours are all need-to-check, in the largest untouched area. Avoid options with miss, sunk or edge neighbours.',
};

function states(board, style) {
  const grid = Object.fromEntries(Array.from({ length: N }, (_, r) =>
    [ROWS[r], Array.from({ length: N }, (_, c) => WORDS[board[r * N + c]])]));
  const columns = Object.fromEntries(Array.from({ length: N }, (_, c) =>
    [String(c + 1), Object.fromEntries(Array.from({ length: N }, (_, r) => [ROWS[r], WORDS[board[r * N + c]]]))]));
  if (style === 'grid') return { grid, grid_order: 'Each row lists columns 1 through 8, left to right.' };
  if (style === 'lists') {
    const of = ch => [...board].flatMap((v, i) => v === ch ? [label(i)] : []);
    return { hit_cells: of('x'), miss_cells: of('o'), sunk_cells: of('#'), need_to_check_cells: of('.') };
  }
  return { grid, grid_order: 'Each row lists columns 1 through 8, left to right.', columns,
    column_order: 'columns repeats the same board vertically: each number is a column, with rows A through H.' };
}

function describe(board, i, style) {
  if (style === 'null') return null;
  if (style === 'state') return `${label(i)}: ${WORDS[board[i]]}`;
  const r = Math.floor(i / N), c = i % N;
  if (style.startsWith('look')) {
    // The cells seen from this one in each direction, nearest first, stopping at the board edge.
    const reach = Number(style.slice(4));
    const look = (dr, dc) => {
      const seen = [];
      for (let k = 1; k <= reach; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr >= N || cc < 0 || cc >= N) { seen.push('edge'); break; }
        seen.push(WORDS[board[rr * N + cc]]);
      }
      return seen.join(', ');
    };
    return `${label(i)}. Up: ${look(-1, 0)}. Down: ${look(1, 0)}. Left: ${look(0, -1)}. Right: ${look(0, 1)}.`;
  }
  if (style === 'nearfar') {
    const at2 = (rr, cc) => rr < 0 || rr >= N || cc < 0 || cc >= N ? 'edge' : WORDS[board[rr * N + cc]];
    return `${label(i)}. Neighbours: up ${at2(r - 1, c)}, down ${at2(r + 1, c)}, left ${at2(r, c - 1)}, right ${at2(r, c + 1)}. One further: up ${at2(r - 2, c)}, down ${at2(r + 2, c)}, left ${at2(r, c - 2)}, right ${at2(r, c + 2)}.`;
  }
  const at = (rr, cc) => rr < 0 || rr >= N || cc < 0 || cc >= N ? 'edge' : WORDS[board[rr * N + cc]];
  return `${label(i)}: ${WORDS[board[i]]}. Neighbours: up ${at(r - 1, c)}, down ${at(r + 1, c)}, left ${at(r, c - 1)}, right ${at(r, c + 1)}.`;
}

export const VARIANTS = {
  production: null,
  previous: 'previous',
  'valid-only': { options: 'valid', criteria: 'state', state: 'both', instructions: null },
  'two-case': { options: 'valid', criteria: 'state', state: 'both', instructions: 'twoCase' },
  'open-water': { options: 'valid', criteria: 'state', state: 'both', instructions: 'openWater' },
  reason: { options: 'valid', criteria: 'state', state: 'both', instructions: 'reason' },
  'hit-first': { options: 'valid', criteria: 'state', state: 'both', instructions: 'hitFirst' },
  'hit-first-short': { options: 'valid', criteria: 'state', state: 'both', instructions: 'hitFirstShort' },
  'hit-first-all': { options: 'all', criteria: 'state', state: 'both', instructions: 'hitFirst' },
  'hit-first-grid': { options: 'valid', criteria: 'null', state: 'grid', instructions: 'hitFirst' },
  'hit-first-lists': { options: 'valid', criteria: 'null', state: 'lists', instructions: 'hitFirst' },
  'open-water-grid': { options: 'valid', criteria: 'null', state: 'grid', instructions: 'openWater' },
  'open-water-lists': { options: 'valid', criteria: 'null', state: 'lists', instructions: 'openWater' },
  neighbours: { options: 'valid', criteria: 'neighbours', state: 'grid', instructions: 'neighbours' },
  look2: { options: 'valid', criteria: 'look2', state: 'grid', instructions: 'look' },
  look3: { options: 'valid', criteria: 'look3', state: 'grid', instructions: 'look' },
  'look2-both': { options: 'valid', criteria: 'look2', state: 'both', instructions: 'look' },
  'look2-literal': { options: 'valid', criteria: 'look2', state: 'grid', instructions: 'lookLiteral' },
  'look2-near': { options: 'valid', criteria: 'look2', state: 'grid', instructions: 'lookNear' },
  'look2-near-why': { options: 'valid', criteria: 'look2', state: 'grid', instructions: 'lookNearWhy' },
  'near-far': { options: 'valid', criteria: 'nearfar', state: 'grid', instructions: 'nearFar' },
  'near-far-end': { options: 'valid', criteria: 'nearfar', state: 'grid', instructions: 'nearFarEnd' },
  'near-far-end2': { options: 'valid', criteria: 'nearfar', state: 'grid', instructions: 'nearFarEnd2' },
  'neighbours-line': { options: 'valid', criteria: 'neighbours', state: 'grid', instructions: 'neighboursLine' },
  'neighbours-line-both': { options: 'valid', criteria: 'neighbours', state: 'both', instructions: 'neighboursLine' },
  'neighbours-all': { options: 'all', criteria: 'neighbours', state: 'grid', instructions: 'neighbours' },
};

export function buildVariant(board, remaining, name, { random = Math.random } = {}) {
  const v = VARIANTS[name];
  if (v === undefined) throw new Error(`Unknown variant ${name}`);
  if (v === null) return production(board, remaining, { random });
  if (v === 'previous') return previous(board, remaining, { random });
  const base = previous(board, remaining, { random: () => .5 });
  // Legality only: a fired cell is not a valid answer, so it is not offered.
  const all = Array.from({ length: N * N }, (_, i) => i), open = all.filter(i => board[i] === '.');
  // A choice needs two labels, so the final untested cell is offered alongside the fired ones.
  const cells = v.options === 'all' || open.length < 2 ? all : open;
  const options = cells.map(i => [label(i), describe(board, i, v.criteria)]);
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return {
    state: {
      board_size: '8 rows A-H, 8 columns 1-8. A1 is top left; H8 is bottom right.',
      initial_ship_lengths: FLEET,
      remaining_ship_lengths: remaining,
      cell_states: base.state.cell_states,
      rules: RULES,
      ...states(board, v.state),
    },
    questions: { shot: choice(v.instructions ? INSTRUCTIONS[v.instructions] : base.questions.shot.instructions, Object.fromEntries(options)) },
  };
}
