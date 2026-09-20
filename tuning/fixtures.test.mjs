import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtures, answerKey, index } from './fixtures.mjs';

test('16 physically consistent cases have an objective answer without a strategy heuristic', () => {
  assert.equal(fixtures.length, 16);
  for (const f of fixtures) {
    assert.equal(f.board.length, 64);
    assert.ok(f.acceptable.length > 0 && f.acceptable.length <= 2);
    assert.deepEqual(answerKey(f.board, f.remaining).acceptable, f.acceptable);
    assert.ok(f.acceptable.every(c => f.board[index(c)] === '.'));
    assert.equal([...f.board].filter(c => c === '#').length, 12 - f.remaining[0]);
    assert.equal(f.placements.length, f.family === 'three-in-line' ? 2 : 1);
  }
});

test('unrotated cases have manually specified valid answers', () => {
  const expected = { 'three-in-line-r0': ['A6', 'E6'], 'blocked-end-r0': ['E5'], 'middle-gap-r0': ['F5'], 'two-cell-finish-r0': ['H7'] };
  for (const [id, cells] of Object.entries(expected)) assert.deepEqual(fixtures.find(f => f.id === id).acceptable, cells);
});
