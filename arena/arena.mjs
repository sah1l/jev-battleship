// Head-to-head series: Jev against general-purpose LLMs, same fleets, same prompt.
// node arena/arena.mjs --games 5 --seed 20261501 --opponents sonnet,minimax --out arena/results.json
// Each game: both captains attack an identical hidden fleet. Fewest shots wins; on a tie the
// captain who shot first wins (first shooter alternates by game, Jev first in game 1).
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import dns from 'node:dns';
import { dirname, resolve } from 'node:path';
import { buildRequest, selectShot } from '../api/shot.js';

try { process.loadEnvFile(); } catch {}
dns.setDefaultResultOrder('ipv4first');
const args = process.argv.slice(2);
const arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const GAMES = Number(arg('--games', 5)), SEED = Number(arg('--seed', 20261501));
const OPPONENTS = arg('--opponents', 'sonnet,minimax').split(',');
const OUT = arg('--out', 'arena/results.json');
const REGION = arg('--region', process.env.AWS_REGION || 'ap-south-1');
const N = 8, ROWS = 'ABCDEFGH', FLEET = [4, 3, 3, 2], MAX_TURNS = 100;
const label = i => ROWS[Math.floor(i / N)] + (i % N + 1);
const index = l => ROWS.indexOf(l[0]) * N + Number(l.slice(1)) - 1;
const seeded = v => () => { v = (Math.imul(v, 1664525) + 1013904223) >>> 0; return v / 4294967296; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Format-only wrapper for models that generate text. Jev takes the structured request natively.
const WRAPPER = 'Evaluate the following structured decision request. Use its state, instructions, and criteria. Return only a JSON object with one string field, "choice", whose value is one supplied option key. Do not include explanations or markdown.';

// USD per million tokens, list prices checked 2026-09-20.
export const CAPTAINS = {
  jev: { name: 'Jev 1.13', vendor: 'TypeSafe AI', price: { in: 0.042, out: 0.042 } },
  // Sonnet 4.6 is the newest Sonnet this Bedrock account is entitled to (Sonnet 5 returns 403).
  sonnet: { name: 'Claude Sonnet 4.6', vendor: 'Anthropic via Bedrock', model: 'global.anthropic.claude-sonnet-4-6', price: { in: 3, out: 15 } },
  minimax: { name: 'MiniMax M3', vendor: 'MiniMax', model: 'MiniMax-M3', price: { in: 0.3, out: 1.2 } },
};

const jevClient = new TypeSafeClient({ timeout: 15000, retry: { maxRetries: 2 } });
function parseChoice(text) {
  const cleaned = String(text).replace(/```(?:json)?/g, '').trim();
  try { return String(JSON.parse(cleaned).choice ?? ''); } catch {}
  return cleaned.match(/"choice"\s*:\s*"([A-H][1-8])"/)?.[1] ?? '';
}
const callers = {
  async jev(request, board) {
    const r = await jevClient.systemOne(request);
    return { choice: selectShot(board, r.answers.shot.probabilities).choice, inTok: r.usage?.input_tokens || 0, outTok: r.usage?.output_tokens || 0, raw: null };
  },
  async sonnet(request) {
    const body = { system: [{ text: WRAPPER }], messages: [{ role: 'user', content: [{ text: JSON.stringify(request) }] }],
      inferenceConfig: { maxTokens: 200, temperature: 0 } };
    const res = await fetch(`https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(CAPTAINS.sonnet.model)}/converse`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.AWS_BEARER_TOKEN_BEDROCK}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const data = await res.json();
    // Never serialize headers or credentials into errors.
    if (!res.ok) throw Object.assign(new Error(`Bedrock HTTP ${res.status}: ${String(data.message || '').replace(/ABSK[\w+/=-]+/g, '[REDACTED]').slice(0, 200)}`), { status: res.status });
    const text = (data.output?.message?.content || []).filter(p => typeof p.text === 'string').map(p => p.text).join('');
    return { choice: parseChoice(text), inTok: data.usage?.inputTokens || 0, outTok: data.usage?.outputTokens || 0, raw: text };
  },
  async minimax(request) {
    const body = { model: CAPTAINS.minimax.model, messages: [{ role: 'system', content: WRAPPER }, { role: 'user', content: JSON.stringify(request) }],
      temperature: 0, max_completion_tokens: 200, thinking: { type: 'disabled' }, reasoning_split: true };
    const res = await fetch('https://api.minimax.io/v1/chat/completions', { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.MINIMAX_API_KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const data = await res.json();
    if (!res.ok || data.base_resp?.status_code) throw Object.assign(new Error(`MiniMax HTTP ${res.status}, code ${data.base_resp?.status_code || data.error?.code || 'unknown'}`), { status: res.status });
    const text = data.choices?.[0]?.message?.content || '';
    return { choice: parseChoice(text), inTok: data.usage?.prompt_tokens || 0, outTok: data.usage?.completion_tokens || 0, raw: text };
  },
};

function placeFleet(random) {
  const taken = new Set();
  return FLEET.map(len => { for (;;) {
    const across = random() < .5;
    const r = Math.floor(random() * (across ? N : N - len + 1)), c = Math.floor(random() * (across ? N - len + 1 : N));
    const cells = Array.from({ length: len }, (_, k) => (r + (across ? 0 : k)) * N + c + (across ? k : 0));
    if (cells.some(i => taken.has(i))) continue;
    cells.forEach(i => taken.add(i));
    return { len, cells };
  } });
}

// One captain clears one fleet. Transport failures are retried and never count as shots.
// An answer that is not an untested cell is a wasted shot: it counts, and the board is unchanged.
async function campaign(captain, fleet, optionSeed) {
  const ships = fleet.map(s => ({ ...s, hits: 0 })), board = Array(64).fill('.'), turns = [];
  let shots = 0;
  while (ships.some(s => s.hits < s.len) && shots < MAX_TURNS) {
    const b = board.join(''), remaining = ships.filter(s => s.hits < s.len).map(s => s.len);
    const request = buildRequest(b, remaining, { random: seeded(optionSeed + shots * 101) });
    let answer, ms;
    for (let attempt = 0; ; attempt++) {
      const start = performance.now();
      try { answer = await callers[captain](request, b); ms = Math.round(performance.now() - start); break; }
      catch (err) { if (attempt >= 9) throw err; await sleep(Math.min(30000, 1500 * 2 ** attempt)); }
    }
    shots++;
    const i = /^[A-H][1-8]$/.test(answer.choice) ? index(answer.choice) : -1;
    const turn = { n: shots, board: b, choice: answer.choice, ms, inTok: answer.inTok, outTok: answer.outTok };
    if (i < 0 || board[i] !== '.') { turn.result = 'invalid'; turn.raw = String(answer.raw ?? '').slice(0, 300); turns.push(turn); continue; }
    const ship = ships.find(s => s.cells.includes(i));
    if (!ship) { board[i] = 'o'; turn.result = 'miss'; }
    else {
      ship.hits++; board[i] = 'x'; turn.result = 'hit';
      if (ship.hits === ship.len) { ship.cells.forEach(c => { board[c] = '#'; }); turn.result = 'sunk'; turn.sunkLen = ship.len; }
    }
    turns.push(turn);
  }
  const price = CAPTAINS[captain].price, inTok = turns.reduce((s, t) => s + t.inTok, 0), outTok = turns.reduce((s, t) => s + t.outTok, 0);
  const times = turns.map(t => t.ms).sort((a, c) => a - c);
  return { captain, shots, cleared: ships.every(s => s.hits === s.len), invalid: turns.filter(t => t.result === 'invalid').length,
    inTok, outTok, costUsd: (inTok * price.in + outTok * price.out) / 1e6, medianMs: times[times.length >> 1],
    totalSeconds: +(times.reduce((s, t) => s + t, 0) / 1000).toFixed(1), turns };
}

if (process.argv[1]?.endsWith('arena.mjs')) {
  // A rerun resumes: finished games in the output file are kept and never replayed.
  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
  const report = previous?.seed === SEED && previous.games === GAMES ? previous : { seed: SEED, games: GAMES, region: REGION, startedAt: new Date().toISOString(), captains: CAPTAINS, wrapper: WRAPPER,
    rules: 'Both captains attack the same hidden fleet with the same prompt and option order. Fewest shots wins; ties go to the first shooter, which alternates by game. The text models run at temperature 0 without extended thinking. Code only checks that a shot is legal.', series: [] };
  const save = () => { mkdirSync(dirname(resolve(OUT)), { recursive: true }); writeFileSync(OUT, JSON.stringify(report, null, 1) + '\n'); };
  const pad = (s, n) => String(s).padEnd(n), money = v => '$' + v.toFixed(v < .01 ? 4 : 3);
  for (const rival of OPPONENTS) {
    console.log(`\n=== ${CAPTAINS.jev.name}  vs  ${CAPTAINS[rival].name}   (best of ${GAMES}, same fleets)`);
    let series = report.series.find(x => x.rival === rival);
    if (!series) { series = { rival, games: [] }; report.series.push(series); }
    await Promise.all(Array.from({ length: GAMES }, async (_, g) => {
      if (series.games[g]) return console.log(`  game ${g + 1}: kept from the earlier run`);
      const fleet = placeFleet(seeded(SEED + g * 1009)), optionSeed = SEED + g * 100003;
      const [jev, other] = await Promise.all([campaign('jev', fleet, optionSeed), campaign(rival, fleet, optionSeed)]);
      const first = g % 2 === 0 ? 'jev' : rival;
      const winner = jev.shots === other.shots ? first : jev.shots < other.shots ? 'jev' : rival;
      series.games[g] = { game: g + 1, fleet, first, winner, jev, rival: other };
      console.log(`  game ${g + 1}: Jev ${pad(jev.shots + ' shots', 9)} ${pad(jev.medianMs + ' ms', 8)} ${pad(money(jev.costUsd), 8)} | ${pad(CAPTAINS[rival].name, 16)} ${pad(other.shots + ' shots', 9)} ${pad(other.medianMs + ' ms', 8)} ${pad(money(other.costUsd), 8)}${other.invalid ? ` (${other.invalid} invalid)` : ''} -> ${CAPTAINS[winner].name} wins`);
      save();
    }));
    const sum = key => side => series.games.reduce((s, x) => s + x[side][key], 0);
    const median = side => { const a = series.games.flatMap(x => x[side].turns.map(t => t.ms)).sort((p, q) => p - q); return a[a.length >> 1]; };
    series.summary = Object.fromEntries(['jev', 'rival'].map(side => [side, {
      wins: series.games.filter(x => x.winner === (side === 'jev' ? 'jev' : rival)).length,
      meanShots: +(sum('shots')(side) / GAMES).toFixed(1), invalid: sum('invalid')(side), medianMs: median(side),
      totalSeconds: +sum('totalSeconds')(side).toFixed(1), costUsd: +sum('costUsd')(side).toFixed(5), inTok: sum('inTok')(side), outTok: sum('outTok')(side) }]));
    const s = series.summary;
    console.log(`  SERIES: Jev ${s.jev.wins} - ${s.rival.wins} ${CAPTAINS[rival].name}`);
    console.table({ [CAPTAINS.jev.name]: s.jev, [CAPTAINS[rival].name]: s.rival });
    save();
  }
  report.finishedAt = new Date().toISOString();
  save();
}
