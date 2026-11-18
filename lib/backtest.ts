// Leave-one-out validation of the token radar's model, run on the snapshot's
// own live-token protocols. For each live-token protocol the calibration is
// refit without it and the model predicts its market cap as if the token had
// not launched yet; the prediction is then compared with the market cap the
// market actually gives it. This is the honest out-of-sample check the model
// deserves: the multiple a protocol calibrates is never allowed to see its
// own ratio. Pure and deterministic: the same snapshot always gives the same
// numbers, with no clock, no randomness and no network.
//
// What it cannot show: sibling pools of the same family stay in the
// calibration while one of them is held out, so the errors are, if anything,
// a little optimistic; and fourteen live protocols record a market cap of
// zero, which no multiple can predict, so they are counted in the calibration
// pools (exactly as the model does) but left out of the scored set, with the
// reason stated in the result.

import {
  computeCalibration,
  impliedValue,
  median,
  medianPreTokenAge,
  type BacktestCase,
  type BacktestResult,
  type ModelConstants,
  type Snapshot,
  type SnapshotProtocol,
} from './model.ts';

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * The average rank of each value, ties sharing the mean of the ranks they
 * cover, so a tied pair counts as neither above nor below the other.
 */
export function averageRanks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const mean = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!.i] = mean;
    i = j + 1;
  }
  return ranks;
}

/** Spearman's rank correlation between two lists of the same length. */
export function spearman(predicted: number[], actual: number[]): number {
  if (predicted.length < 2 || predicted.length !== actual.length) return 0;
  const rx = averageRanks(predicted);
  const ry = averageRanks(actual);
  const n = predicted.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]! - mx;
    const b = ry[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

/**
 * The leave-one-out run: every live-token protocol outside the exchange
 * category, with a market cap above zero, is held out once, the calibration
 * is refit from the rest, and the model predicts its market cap with the
 * same formula that scores the board. Exchanges are left out of the
 * calibration entirely (their rows are never ranked), and zero-or-less-cap
 * protocols are left out of the scored set because no multiple predicts zero.
 */
export function runLeaveOneOut(snapshot: Snapshot, model: ModelConstants): BacktestResult {
  const live = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  const scored = live.filter((p) => p.mcap_usd! > 0);
  const unknownAgeDays = medianPreTokenAge(snapshot) ?? model.unknown_age_days;
  const cases: BacktestCase[] = scored.map((held) => {
    const pool: SnapshotProtocol[] = live.filter((p) => p.slug !== held.slug);
    const refit = computeCalibration({ ...snapshot, protocols: pool }, model);
    const { implied } = impliedValue(held, snapshot.as_of, model, refit, unknownAgeDays);
    const actual = held.mcap_usd!;
    return {
      slug: held.slug,
      name: held.name,
      category: held.category,
      predicted_usd: implied,
      actual_usd: actual,
      error_multiple: round3(Math.max(implied, actual) / Math.min(implied, actual)),
    };
  });
  const n = cases.length;
  const within = (f: number): number =>
    n === 0 ? 0 : round4(cases.filter((c) => c.error_multiple <= f).length / n);
  const byError = [...cases].sort((a, b) => a.error_multiple - b.error_multiple || (a.slug < b.slug ? -1 : 1));
  return {
    n,
    within_2x: within(2),
    within_3x: within(3),
    spearman: round3(spearman(cases.map((c) => c.predicted_usd), cases.map((c) => c.actual_usd))),
    median_error_multiple: round3(n === 0 ? 0 : median(cases.map((c) => c.error_multiple))),
    worst: [...byError].reverse().slice(0, 5),
    best: byError.slice(0, 5),
    note:
      `${live.length - scored.length} live-token protocols record a market cap of zero or less and are ` +
      `left out of the scored set, and the exchange category is left out of the calibration entirely; ` +
      `sibling pools of one family stay in the pool while a sibling is held out, so these errors are, ` +
      `if anything, a little optimistic.`,
  };
}
