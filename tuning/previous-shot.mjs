import { TypeSafeClient, choice } from '@typesafe-ai/sdk';
const N = 8;

const FLEET = [4, 3, 3, 2];
const ROWS = 'ABCDEFGH';
const label = i => ROWS[Math.floor(i / N)] + (i % N + 1);

let client;
const getClient = () => client ??= new TypeSafeClient({ timeout: 4000, retry: { maxRetries: 1 } });

// Best-effort limit per warm instance; keeps one visitor from draining the shared key.
const LIMIT = 45, WINDOW_MS = 60_000;
const seen = new Map();
function limited(ip) {
  const now = Date.now();
  const stamps = (seen.get(ip) || []).filter(t => now - t < WINDOW_MS);
  stamps.push(now);
  seen.set(ip, stamps);
  if (seen.size > 5000) seen.clear();
  return stamps.length > LIMIT;
}

function validRemaining(remaining) {
  if (!Array.isArray(remaining) || !remaining.length || remaining.length > FLEET.length) return false;
  const pool = [...FLEET];
  for (const len of remaining) {
    const at = pool.indexOf(len);
    if (at < 0) return false;
    pool.splice(at, 1);
  }
  return true;
}

// Every cell remains an option; Jev applies the instructions without local strategy filtering.
export function buildRequest(board, remaining, { random = Math.random } = {}) {
  const states = { '.': 'need-to-check', o: 'miss', x: 'hit', '#': 'sunk' };
  const grid = Object.fromEntries(Array.from({ length: N }, (_, r) =>
    [ROWS[r], Array.from({ length: N }, (_, c) => states[board[r * N + c]])]));
  // A second reading direction for the same observations, with no inferred targets.
  const columns = Object.fromEntries(Array.from({ length: N }, (_, c) =>
    [String(c + 1), Object.fromEntries(Array.from({ length: N }, (_, r) => [ROWS[r], states[board[r * N + c]]]))]));
  const options = Array.from({ length: N * N }, (_, i) =>
    [label(i), `${label(i)}: ${states[board[i]]}`]);
  // Change presentation order only; every option retains the same state and text.
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  const criteria = Object.fromEntries(options);
  return {
    state: {
      board_size: '8 rows A-H, 8 columns 1-8. A1 is top left; H8 is bottom right.',
      initial_ship_lengths: FLEET,
      remaining_ship_lengths: remaining,
      cell_states: {
        'need-to-check': 'Not fired at yet. May contain a remaining ship. This is the only selectable state.',
        miss: 'Already fired at: empty water. Cannot contain a ship. Do not select.',
        hit: 'Already fired at: part of a ship still afloat. Find its other cells. Do not select this cell again.',
        sunk: 'Already fired at: part of a destroyed ship. That ship is finished and excluded from remaining_ship_lengths. Do not select.',
      },
      rules: 'Each ship is a straight, consecutive horizontal or vertical line of its stated length. Ships cannot overlap but may touch. Remaining ships cannot pass through miss or sunk cells. A ship is sunk only when all its cells are hit.',
      grid,
      grid_order: 'Each row lists columns 1 through 8, left to right.',
      columns,
      column_order: 'columns repeats the same board vertically: each number is a column, with rows A through H.',
    },
    questions: {
      shot: choice('Win using as few shots as possible. Given the entire observed board and remaining fleet, choose the need-to-check cell that minimizes the expected number of additional shots needed to sink all remaining ships. ' +
        'WHILE THERE ARE NO UNSUNK HITS, KEEP SHOTS DISTRIBUTED ACROSS THE ENTIRE BOARD, PRIORITIZING UNEXPLORED GAPS WHERE AT LEAST ONE REMAINING SHIP CAN FIT. CONTINUE THIS DISTRIBUTED SEARCH UNTIL A HIT; THEN FOCUS ON FINISHING THAT SHIP. RESUME DISTRIBUTED SEARCH WHEN NO UNSUNK HITS REMAIN. ' +
        'Distinguish unsunk hits from sunk ships. Use unsunk hits, misses, and remaining ship lengths to infer possible ship orientations. Prefer legal extensions of aligned unsunk hits over sideways neighbors unless the board supports another explanation. Once a ship sinks, stop treating its cells as unresolved hits. When no unsunk hits remain, resume searching unexplored gaps across the entire board that can fit a remaining ship; a cell is not a better target merely because it is near a sunk ship.', criteria),
    },
  };
}

// Select directly from Jev's distribution; the only restriction is a legal shot.
export function selectShot(board, probabilities) {
  let target = null, best = -1;
  for (let i = 0; i < N * N; i++) {
    const p = probabilities?.[label(i)];
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
      throw new Error(`Missing or invalid probability for ${label(i)}`);
    }
    if (board[i] === '.' && p > best) { target = label(i); best = p; }
  }
  if (target === null || best <= 0) throw new Error('No positive probability for an untested cell');
  return { choice: target, confidence: best };
}

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new Error('too large');
  }
  return JSON.parse(raw || '{}');
}

export default async function handler(req, res) {
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') return send(405, { error: 'method' });

  const origin = req.headers.origin;
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch {}
    if (host !== req.headers.host) return send(403, { error: 'origin' });
  }
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (limited(ip)) return send(429, { error: 'slow_down' });

  let body;
  try { body = await readBody(req); } catch { return send(400, { error: 'body' }); }
  const { board, remaining } = body || {};
  if (typeof board !== 'string' || !/^[.ox#]{64}$/.test(board) || !board.includes('.') || !validRemaining(remaining)) {
    return send(400, { error: 'board' });
  }

  const started = performance.now();
  try {
    if (!process.env.TYPESAFE_API_KEY) return send(503, { error: 'no_key' });
    const result = await getClient().systemOne(buildRequest(board, remaining));
    const answer = result.answers.shot;
    const selected = selectShot(board, answer.probabilities);
    send(200, {
      choice: selected.choice,
      confidence: selected.confidence,
      probabilities: answer.probabilities,
      ms: Math.round(performance.now() - started),
      model: result.model,
      tokens: result.usage?.input_tokens || 0,
      source: 'jev',
    });
  } catch (err) {
    console.error('jev call failed', err?.status, err?.message);
    send(err?.status === 429 ? 429 : 502, { error: 'jev_unavailable' });
  }
}
