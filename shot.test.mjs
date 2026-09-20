import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, selectShot } from './api/shot.js';

const empty = '.'.repeat(64);
const probabilities = () => Object.fromEntries(Object.keys(buildRequest(empty, [4, 3, 3, 2]).questions.shot.criteria).map(cell => [cell, 1 / 64]));

test('shuffling changes only option order, preserving the board and all option descriptions', () => {
  const board = 'ox#' + '.'.repeat(61);
  const ordered = buildRequest(board, [2], { random: () => .999999 });
  const shuffled = buildRequest(board, [2], { random: () => 0 });
  assert.deepEqual(shuffled.state, ordered.state);
  assert.equal(shuffled.questions.shot.instructions, ordered.questions.shot.instructions);
  assert.notDeepEqual(Object.keys(shuffled.questions.shot.criteria), Object.keys(ordered.questions.shot.criteria));
  assert.deepEqual(Object.entries(shuffled.questions.shot.criteria).sort(), Object.entries(ordered.questions.shot.criteria).sort());
});

test('only untested cells are offered, each described by its observed surroundings', () => {
  const board = 'ox#' + '.'.repeat(61), request = buildRequest(board, [2]);
  const criteria = request.questions.shot.criteria;
  assert.deepEqual(Object.keys(criteria).sort(), [...board].flatMap((ch, i) => ch === '.' ? ['ABCDEFGH'[i >> 3] + (i % 8 + 1)] : []).sort());
  assert.equal(criteria.A4, 'A4. Neighbours: up edge, down need-to-check, left sunk, right need-to-check. One further: up edge, down need-to-check, left hit, right need-to-check.');
  assert.equal(criteria.B1, 'B1. Neighbours: up miss, down need-to-check, left edge, right need-to-check. One further: up edge, down need-to-check, left edge, right need-to-check.');
  assert.deepEqual(request.state.grid.A.slice(0, 4), ['miss', 'hit', 'sunk', 'need-to-check']);
  assert.deepEqual(request.state.initial_ship_lengths, [4, 3, 3, 2]);
  assert.deepEqual(request.state.remaining_ship_lengths, [2]);
  assert.equal(Object.keys(buildRequest('.'.repeat(64), [4, 3, 3, 2]).questions.shot.criteria).length, 64);
  // A choice needs two labels, so the last untested cell is offered with the fired cells.
  assert.equal(Object.keys(buildRequest('o'.repeat(63) + '.', [2]).questions.shot.criteria).length, 64);
});

test('selection uses Jev ranking including corners, excluding only tested cells', () => {
  const p = probabilities();
  p.A1 = .7; p.H8 = .2;
  assert.deepEqual(selectShot(empty, p), { choice: 'A1', confidence: .7 });
  assert.deepEqual(selectShot('o' + empty.slice(1), p), { choice: 'H8', confidence: .2 });
});

test('incomplete, invalid, or unusable distributions fail instead of using a strategy', () => {
  for (const value of [undefined, NaN, -1, 2]) {
    const p = probabilities(); p.H8 = value;
    assert.throws(() => selectShot(empty, p));
    // Fired cells are not offered, so nothing is required of them.
    assert.equal(selectShot(empty.slice(0, 63) + 'o', p).choice, 'A1');
  }
  const p = probabilities(); Object.keys(p).forEach(k => p[k] = 0);
  assert.throws(() => selectShot(empty, p));
});
