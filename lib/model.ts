// The token radar's valuation model: fitted from the snapshot itself, at run time, every run.
//
// Nothing in this file is a hand-set multiple. The program takes the snapshot's own token-bearing
// protocols (the ones DefiLlama records a market cap for) as a calibration set and fits, in log
// space, what a token trades for against the figures the snapshot carries:
//
//   ln(mcap) = b0 + b1 * ln(tvl) + b2 * growth + b3 * ln(1 + age_days) + category_offset
//
//   growth          the 7-day TVL change in per cent, over 100, winsorised to the calibration
//                   set's own 5th..95th percentile range before it is fitted or read. In this
//                   snapshot a handful of protocols whose TVL halved in the week still carry
//                   full-size tokens; left unwinsorised they alone would bend the growth term
//                   until one hot week could move a value a hundredfold. Winsorised, the whole
//                   term swings a value by about half a log unit end to end. A protocol with no
//                   recorded change scores 0, the calibration median's answer.
//   age_days        days from listed_at to the snapshot's as_of; unknown ages take the
//                   calibration set's median age, never a round number of ours.
//   category_offset the calibration residuals' mean for the protocol's category, shrunk by
//                   n / (n + 20) toward zero and capped at +/-0.75 log units, so a category with
//                   three members barely moves a value and none can dominate one.
//
// The fit is ordinary least squares on the normal equations, solved by Gauss-Jordan elimination:
// no library, no network, no randomness, so two runs over the same snapshot agree byte for byte.
//
// The model grades itself before it ranks anything. Two deterministic splits of the calibration
// set (by a hash of the slug, so the split is a property of the data, not of a coin flip) refit
// the model on one part and score the other: log-space RMSE, median absolute percentage error
// and the share of held-out tokens valued within a factor of two. The pooled held-out residuals'
// 10th and 90th percentiles become every board row's value interval. The numbers ship in the
// board's data, stated as they came out: on this snapshot the fit is honest about being wide,
// and the interval on each row says how wide.
//
// A pre-token protocol's implied value is the fitted line read at its own figures. The board
// covers the whole watchlist and adds the strongest early protocols below the floor until it
// holds BOARD_ROWS rows; rank is by implied value, ties by slug, and no name is special-cased.
// The early rows are drawn by the watchlist's own eligibility rule (see isRankable): a radar
// for launches still to come does not headline wrapped Bitcoin or an exchange's staking
// product, whatever their TVL — those are another token's product, not a launch of their own.

import { farmSteps, stepText } from './farm.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The fitted model's shape: coefficients, the category offsets and the calibration it came from. */
export interface FittedModel {
  intercept: number;
  tvl_coef: number;
  growth_coef: number;
  age_coef: number;
  category_offsets: Record<string, number>;
  median_age_days: number;
  growth_lo_pct: number;
  growth_hi_pct: number;
  calibration_size: number;
}

/** One held-out split's scorecard, plus the pooled interval the board rows carry. */
export interface Validation {
  splits: { name: string; train_size: number; test_size: number; log_rmse: number; median_ape_pct: number; within_2x_pct: number }[];
  interval_low_factor: number;
  interval_high_factor: number;
}

/** One row of board.json: the ranked board's row, with the basis the value was read from. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    value_low_usd: number;
    value_high_usd: number;
    growth_pct: number;
    age_days: number | null;
    category_offset: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row's numbers, its basis and its farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  multiple: number;
  watchlist: boolean;
  growth_pct: number;
  category_offset: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fitted model and its scorecard. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fitted: FittedModel;
  validation: Validation;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2-fitted';

/** How many rows the board holds: the whole watchlist plus the strongest early protocols. */
export const BOARD_ROWS = 240;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The category offset's shrinkage: an offset counts for n / (n + SHRINK) of its raw mean. */
const CATEGORY_SHRINK = 20;

/** The most a category offset may move a value, in log units. */
const CATEGORY_OFFSET_CAP = 0.75;

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 1e2) / 1e2;

/** A whole day count from listed_at to as_of, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The 7-day change as the model reads it: per cent winsorised to [lo, hi], over 100; none recorded reads 0. */
function growthTerm(p: SnapshotProtocol, lo: number, hi: number): number {
  const raw = p.change_7d === null ? 0 : p.change_7d;
  return Math.min(hi, Math.max(lo, raw)) / 100;
}

/** FNV-1a over the slug: the deterministic hash the validation splits are dealt by. */
function slugHash(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Least squares by the normal equations, solved with Gauss-Jordan elimination and partial pivoting. */
function leastSquares(x: number[][], y: number[]): number[] {
  const n = x[0]!.length;
  const a: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const b: number[] = Array(n).fill(0);
  for (let r = 0; r < x.length; r++) {
    for (let i = 0; i < n; i++) {
      b[i]! += x[r]![i]! * y[r]!;
      for (let j = 0; j < n; j++) a[i]![j]! += x[r]![i]! * x[r]![j]!;
    }
  }
  for (let i = 0; i < n; i++) a[i]![i]! += 1e-9;
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r]![i]!) > Math.abs(a[piv]![i]!)) piv = r;
    [a[i], a[piv]] = [a[piv]!, a[i]!];
    [b[i], b[piv]] = [b[piv]!, b[i]!];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = a[r]![i]! / a[i]![i]!;
      for (let c = i; c < n; c++) a[r]![c]! -= f * a[i]![c]!;
      b[r]! -= f * b[i]!;
    }
  }
  return b.map((v, i) => v / a[i]![i]!);
}

/** The design row of one protocol, before its category offset: intercept, log TVL, growth, log age. */
function designRow(p: SnapshotProtocol, asOf: string, medianAge: number, growthLo: number, growthHi: number): number[] {
  const age = ageDays(asOf, p.listed_at) ?? medianAge;
  return [1, Math.log(p.tvl_usd), growthTerm(p, growthLo, growthHi), Math.log1p(age)];
}

/** The median of a non-empty list of day counts. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Fit the model on a calibration set (protocols with a recorded market cap): two passes, the
 * second after the category offsets are read off the first pass's residuals.
 */
export function fitModel(calibration: SnapshotProtocol[], asOf: string): FittedModel {
  const ages = calibration.map((p) => ageDays(asOf, p.listed_at)).filter((v): v is number => v !== null);
  const medianAge = ages.length > 0 ? medianOf(ages) : 0;
  const changes = calibration.map((p) => p.change_7d).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const growthLo = changes.length > 0 ? changes[Math.floor(0.05 * changes.length)]! : -60;
  const growthHi = changes.length > 0 ? changes[Math.min(changes.length - 1, Math.floor(0.95 * changes.length))]! : 120;
  const y = calibration.map((p) => Math.log(p.mcap_usd!));
  const base = calibration.map((p) => designRow(p, asOf, medianAge, growthLo, growthHi));
  let beta = leastSquares(base, y);
  const byCategory = new Map<string, number[]>();
  calibration.forEach((p, i) => {
    const predicted = base[i]!.reduce((t, v, j) => t + v * beta[j]!, 0);
    const key = p.category ?? '';
    const list = byCategory.get(key) ?? [];
    list.push(y[i]! - predicted);
    byCategory.set(key, list);
  });
  const offsets: Record<string, number> = {};
  for (const [category, residuals] of byCategory) {
    const mean = residuals.reduce((t, v) => t + v, 0) / residuals.length;
    const shrunk = mean * (residuals.length / (residuals.length + CATEGORY_SHRINK));
    offsets[category] = Math.max(-CATEGORY_OFFSET_CAP, Math.min(CATEGORY_OFFSET_CAP, shrunk));
  }
  // The offsets are additive terms, not regressors: the second pass refits the four base
  // coefficients against the target with each row's offset already removed.
  const adjusted = y.map((v, i) => v - (offsets[calibration[i]!.category ?? ''] ?? 0));
  beta = leastSquares(base, adjusted);
  return {
    intercept: beta[0]!,
    tvl_coef: beta[1]!,
    growth_coef: beta[2]!,
    age_coef: beta[3]!,
    category_offsets: offsets,
    median_age_days: medianAge,
    growth_lo_pct: growthLo,
    growth_hi_pct: growthHi,
    calibration_size: calibration.length,
  };
}

/** The fitted line read at one protocol: its log value before the exponential. */
function fittedLogValue(model: FittedModel, p: SnapshotProtocol, asOf: string): number {
  const row = designRow(p, asOf, model.median_age_days, model.growth_lo_pct, model.growth_hi_pct);
  const offset = model.category_offsets[p.category ?? ''] ?? 0;
  return model.intercept + model.tvl_coef * row[1]! + model.growth_coef * row[2]! + model.age_coef * row[3]! + offset;
}

/** One protocol's implied value and interval under the fitted model. */
export function impliedValue(model: FittedModel, validation: Validation, p: SnapshotProtocol, asOf: string): { implied: number; low: number; high: number; offset: number } {
  const centre = Math.exp(fittedLogValue(model, p, asOf));
  return {
    implied: Math.max(1, Math.round(centre)),
    low: Math.max(1, Math.round(centre * validation.interval_low_factor)),
    high: Math.round(centre * validation.interval_high_factor),
    offset: model.category_offsets[p.category ?? ''] ?? 0,
  };
}

/**
 * Grade the model on two deterministic held-out splits of the calibration set. Each split refits
 * on its train part alone, so the scorecard never grades a fit on data it was fitted to.
 */
export function validateModel(calibration: SnapshotProtocol[], asOf: string): Validation {
  const splits: Validation['splits'] = [];
  const pooled: number[] = [];
  const deals: { name: string; test: (p: SnapshotProtocol) => boolean }[] = [
    { name: 'slug-hash parity', test: (p) => slugHash(p.slug) % 2 === 1 },
    { name: 'slug-hash mod 5', test: (p) => slugHash(p.slug) % 5 === 0 },
  ];
  for (const deal of deals) {
    const train = calibration.filter((p) => !deal.test(p));
    const test = calibration.filter(deal.test);
    const model = fitModel(train, asOf);
    const errors = test.map((p) => fittedLogValue(model, p, asOf) - Math.log(p.mcap_usd!));
    const rmse = Math.sqrt(errors.reduce((t, e) => t + e * e, 0) / errors.length);
    const ape = errors.map((e) => Math.abs(Math.exp(e) - 1) * 100).sort((a, b) => a - b);
    const within = errors.filter((e) => Math.abs(e) < Math.LN2).length / errors.length;
    splits.push({
      name: deal.name,
      train_size: train.length,
      test_size: test.length,
      log_rmse: round4(rmse),
      median_ape_pct: round2(ape[Math.floor(ape.length / 2)]!),
      within_2x_pct: round2(within * 100),
    });
    pooled.push(...errors);
  }
  const sorted = [...pooled].sort((a, b) => a - b);
  const q = (f: number): number => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))]!;
  // A held-out residual is log(actual) - log(predicted); a new value's interval inverts it.
  return { splits, interval_low_factor: round4(Math.exp(-q(0.9))), interval_high_factor: round4(Math.exp(-q(0.1))) };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The categories the house's own watchlist rule sets aside as products of another protocol:
 * a wrapped, staked or bridged representation of a token that already trades is not a launch
 * still to come, however large it grows.
 */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name that gives a product of another protocol away: a whole word wrapped/staked/staking, or an exchange's name first. */
const PRODUCT_NAME = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a protocol is one the board may rank: pre-token, and by the same rule the house drew
 * the watchlist with, a protocol that could still launch a token of its own — not a versioned
 * pool, not an exchange, and not a wrapped, staked or bridged product of someone else's token.
 * The watchlist rows themselves are always carried, rule or not: coverage is the gate's row.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !VERSIONED.test(p.name) && !PRODUCT_CATEGORIES.has(p.category ?? '') && !PRODUCT_NAME.test(p.name) && !EXCHANGE_NAME.test(p.name);
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: FittedModel, validation: Validation): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const scored = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .map((p) => ({ p, value: impliedValue(model, validation, p, snapshot.as_of) }))
    .sort((a, b) => b.value.implied - a.value.implied || (a.p.slug < b.p.slug ? -1 : 1));
  for (const s of scored) {
    if (chosen.size >= BOARD_ROWS) break;
    chosen.set(s.p.slug, s.p);
  }
  const rows = [...chosen.values()].map((p) => {
    const value = impliedValue(model, validation, p, snapshot.as_of);
    return { p, value, age: ageDays(snapshot.as_of, p.listed_at) };
  });
  rows.sort((a, b) => b.value.implied - a.value.implied || (a.p.slug < b.p.slug ? -1 : 1));
  return rows.map((r, i) => ({
    rank: i + 1,
    slug: r.p.slug,
    name: r.p.name,
    category: r.p.category,
    chains: r.p.chains,
    tvl_usd: r.p.tvl_usd,
    change_7d: r.p.change_7d,
    mcap_usd: r.p.mcap_usd,
    listed_at: r.p.listed_at,
    gecko_id: r.p.gecko_id,
    symbol: r.p.symbol,
    token_status: 'pre-token',
    age_days: r.age,
    implied_value_usd: r.value.implied,
    model: {
      multiple: round4(r.value.implied / r.p.tvl_usd),
      value_low_usd: r.value.low,
      value_high_usd: r.value.high,
      growth_pct: round2(growthTerm(r.p, model.growth_lo_pct, model.growth_hi_pct) * 100),
      age_days: r.age,
      category_offset: round4(r.value.offset),
    },
    farm_steps: farmSteps(r.p, r.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** A board row's form for data.js: the numbers, the basis they were read from, the farm plan. */
export function radarRow(row: BoardRow, watchlist: ReadonlySet<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    value_low_usd: row.model.value_low_usd,
    value_high_usd: row.model.value_high_usd,
    multiple: row.model.multiple,
    watchlist: watchlist.has(row.slug),
    growth_pct: row.model.growth_pct,
    category_offset: row.model.category_offset,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot: fit, grade, then rank. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const calibration = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const validation = validateModel(calibration, snapshot.as_of);
  const model = fitModel(calibration, snapshot.as_of);
  const board = buildBoard(snapshot, model, validation);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fitted: model,
    validation,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watch)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value: a board that ranks nothing';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
