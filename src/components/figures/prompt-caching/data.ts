/**
 * Numbers behind the prompt caching post's figures and worked examples, in
 * one place so the text and the figures agree.
 *
 * Prices are an example, not a quote: $3 per million input tokens and $15
 * per million output tokens, with Anthropic's multipliers for cache writes
 * (1.25× for the 5-minute TTL, 2× for 1 hour) and cache reads (0.1×), which
 * are Claude Sonnet 4.6's list prices. Newer models discount reads further,
 * which makes a miss relatively more expensive, not less.
 */

export const PRICE = {
  /** Dollars per million tokens. */
  base: 3,
  output: 15,
  read: 0.1,
  write5m: 1.25,
  write1h: 2,
} as const;

const perM = (tokens: number, rate: number) => (tokens / 1e6) * rate;
export const usd = (v: number, digits = 2) => `$${v.toFixed(digits)}`;
export const kTok = (n: number) => `${Math.round(n / 1000)}k`;
export const num = (n: number) => Math.round(n).toLocaleString("en-US");

// ---- The idle gap (expired TTL) ---------------------------------------------

export const IDLE = {
  history: 100_000,
  message: 3,
  response: 800,
  gapMin: 7,
  ttlMin: 5,
};
/** What the 100k-token history costs on the next request. */
export const IDLE_COST = {
  hit: perM(IDLE.history, PRICE.base * PRICE.read),
  miss: perM(IDLE.history, PRICE.base * PRICE.write5m),
  response: perM(IDLE.response, PRICE.output),
};

// ---- Pruning break-even ------------------------------------------------------

export const PRUNE = {
  /** Tokens removed from the middle of the transcript. */
  pruned: 8_000,
  /** Tokens after the cut, which follow a mismatch once it's made. */
  after: 60_000,
};
/** In base-price token equivalents. */
export const PRUNE_COST = {
  rewrite: PRUNE.after * (1 - PRICE.read),
  rewriteWithWrite: PRUNE.after * (PRICE.write5m - PRICE.read),
  savedPerTurn: PRUNE.pruned * PRICE.read,
};
export const BREAK_EVEN = {
  turns: PRUNE_COST.rewrite / PRUNE_COST.savedPerTurn,
  turnsWithWrite: PRUNE_COST.rewriteWithWrite / PRUNE_COST.savedPerTurn,
};

// ---- Input cost per turn, by context length and hit rate ----------------------

/** Input cost of one turn: hits at the read price, the rest at base (no write premium). */
export const turnCost = (context: number, hit: number) => perM(context * hit, PRICE.base * PRICE.read) + perM(context * (1 - hit), PRICE.base);

// ---- Long and stable vs short and unstable -------------------------------------

export const SESSIONS = [
  { id: "a", label: "Session A", note: "100k tokens, stable prefix", total: 100_000, hit: 0.95 },
  { id: "b", label: "Session B", note: "20k tokens, timestamp in the system prompt", total: 20_000, hit: 0.05 },
].map((s) => ({ ...s, cached: s.total * s.hit, cost: turnCost(s.total, s.hit) }));

// ---- A session trace -------------------------------------------------------------

/**
 * A 40-turn coding session. The prefix is tool definitions and a system
 * prompt; each turn appends a model reply, tool results and a message, in a
 * fixed repeating pattern (no randomness, so the figure is the same on every
 * load). Two turns miss: one after an idle gap longer than the 5-minute TTL,
 * one after the harness added two tools to the tool list.
 */
const TOOLS = 9_000;
const SYSTEM = 3_000;
const APPEND = [1_800, 4_200, 2_600, 5_100, 3_000];
export const TURNS = 40;
export const MISSES: Record<number, { why: string; detail: string }> = {
  17: { why: "Idle 11 min", detail: "Tests and review ran past the 5-minute TTL; the entry was evicted." },
  29: { why: "+2 tools", detail: "The harness added two tools to the tool list, which is rendered first." },
};
const OUTPUT = 600;

export interface Turn {
  n: number;
  total: number;
  read: number;
  write: number;
  miss?: { why: string; detail: string };
  /** Input cost, dollars. */
  cost: number;
  /** What this turn's input would have cost on a hit. */
  hitCost: number;
}

export const TRACE: Turn[] = (() => {
  const out: Turn[] = [];
  let prev = 0;
  let tools = TOOLS;
  for (let n = 1; n <= TURNS; n++) {
    const miss = MISSES[n];
    if (n === 29) tools += 1_200;
    const conv = Array.from({ length: n }, (_, i) => APPEND[i % APPEND.length]).reduce((a, b) => a + b, 0);
    const total = tools + SYSTEM + conv;
    const read = n === 1 || miss ? 0 : prev;
    const write = total - read;
    const cost = perM(read, PRICE.base * PRICE.read) + perM(write, PRICE.base * PRICE.write5m);
    const hitRead = n === 1 ? 0 : prev;
    const hitCost = perM(hitRead, PRICE.base * PRICE.read) + perM(total - hitRead, PRICE.base * PRICE.write5m);
    out.push({ n, total, read, write, miss, cost, hitCost });
    prev = total;
  }
  return out;
})();

export const REPORT = (() => {
  const input = TRACE.reduce((a, t) => a + t.total, 0);
  const cached = TRACE.reduce((a, t) => a + t.read, 0);
  const output = TURNS * OUTPUT;
  const inputCost = TRACE.reduce((a, t) => a + t.cost, 0);
  const cost = inputCost + perM(output, PRICE.output);
  const misses = TRACE.filter((t) => t.miss).map((t) => ({ n: t.n, why: t.miss!.why, tokens: t.write, extra: t.cost - t.hitCost }));
  const extra = misses.reduce((a, m) => a + m.extra, 0);
  /** The mean of per-request hit rates: the misleading way to average. */
  const meanOfRates = TRACE.reduce((a, t) => a + t.read / t.total, 0) / TURNS;
  return { input, cached, hit: cached / input, meanOfRates, output, cost, misses, extra, extraShare: extra / cost };
})();
