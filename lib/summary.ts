// The verdict and the headline numbers: what the board is worth farming,
// and the six figures the dashboard's KPI strip prints. It sits on top of
// the ranking model and the sized farm plan, and changes neither: the
// verdict only reads a row's plan, and the summary only adds the board up.
// Pure and deterministic, with no clock, no randomness and no network.
//
// THE VERDICT RULE, stated once here and again in the README and the page:
//   net = the plan's middle expected value minus the gas the plan itself
//         charges (setup gas plus $2 a week over the hold)
//   FARM     when net >= $25   — the expected value clears the gas by a margin
//                               worth the position's time
//   MARGINAL when net >= $0    — it pays for its own gas, barely
//   SKIP     when net < $0      — the gas eats the whole expected value
// The $25 line is a judgment call, not a fit: it is the smallest net that
// still buys a farmer's week of attention, and on this snapshot it leaves
// 14 FARM rows out of 244 — a shortlist, not a stampede. The gas is the
// plan's own: the farm steps charge about $8 of setup gas on a $150+
// position ($4 below that) and about $2 of gas a week, so the verdict
// charges exactly what the plan already tells the farmer to pay.

import type { FarmPlan } from './farmplan.ts';
import type { AuditRow, BacktestResult } from './model.ts';

/** The three verdicts the board prints, from the net after gas. */
export type Verdict = 'FARM' | 'MARGINAL' | 'SKIP';

/** The net a protocol clears, and the verdict that net earns. */
export interface VerdictResult {
  verdict: Verdict;
  /** The middle expected value minus gas, in dollars (one decimal). */
  netUsd: number;
  /** The gas charged: setup gas plus $2 a week over the hold, in dollars. */
  gasUsd: number;
}

/** The net a FARM verdict needs: $25 above gas. */
export const FARM_NET_USD = 25;
/** The weekly gas the plan charges, in dollars, for every week of the hold. */
const WEEKLY_GAS_USD = 2;
/** The setup gas on a $150-or-more position; smaller positions pay $4. */
const SETUP_GAS_LARGE_USD = 8;
const SETUP_GAS_SMALL_USD = 4;
/** The capital at which the setup gas steps up from $4 to $8. */
const SETUP_GAS_STEP_USD = 150;

/**
 * The gas one farm plan charges: the setup gas from its own capital tier
 * plus $2 for every week of its hold (a 45-day hold is 6.4 weeks, so
 * $12.9 of weekly gas). The same numbers the farm steps quote, so the
 * verdict and the steps can never disagree about what farming costs.
 */
export function gasForPlan(plan: FarmPlan): number {
  const setup = plan.capitalUsd >= SETUP_GAS_STEP_USD ? SETUP_GAS_LARGE_USD : SETUP_GAS_SMALL_USD;
  return Math.round((setup + WEEKLY_GAS_USD * (plan.holdDays / 7)) * 10) / 10;
}

/** A protocol's verdict: its middle expected value, less its own gas. */
export function verdictFor(plan: FarmPlan): VerdictResult {
  const gasUsd = gasForPlan(plan);
  const netUsd = Math.round((plan.evMidUsd - gasUsd) * 10) / 10;
  const verdict: Verdict = netUsd >= FARM_NET_USD ? 'FARM' : netUsd >= 0 ? 'MARGINAL' : 'SKIP';
  return { verdict, netUsd, gasUsd };
}

/** One slice of the reconciliation: why protocols were set aside, and how many. */
export interface ReconciliationReason {
  reason: string;
  count: number;
}

/** The whole reconciliation: every protocol the snapshot read, accounted for. */
export interface Reconciliation {
  /** Protocols in the snapshot. */
  total: number;
  /** Protocols the board ranks. */
  ranked: number;
  /** Protocols that already trade. */
  live_token: number;
  /** Pre-token protocols the board sets aside. */
  set_aside: number;
  /** The set-aside, broken down by its reason. */
  reasons: ReconciliationReason[];
}

/** The six KPI-strip figures and the reconciliation behind them. */
export interface Summary {
  /** Protocols the board ranks. */
  ranked: number;
  /** The board's implied values, summed. */
  total_implied_usd: number;
  /** The backtest's median error multiple: how far off the model usually is. */
  out_of_sample_miss: number;
  /** The share of held-out market caps inside the printed P25-P75 band, 0..1. */
  range_holds: number;
  /** The share of backtest predictions within twice the market cap, 0..1. */
  within_2x: number;
  /** Rows whose verdict is FARM. */
  worth_farming: number;
  /** Every row's verdict, counted. */
  verdicts: { farm: number; marginal: number; skip: number };
  /** Every protocol the snapshot read, accounted for. */
  reconciliation: Reconciliation;
}

/** The set-aside reasons in the order the reconciliation bar prints them. */
const REASON_ORDER = [
  'family token already live',
  'versioned pool',
  'exchange',
  'wrapped, staked or bridged product',
];

/**
 * The dashboard's headline numbers from the enriched board (each row
 * carrying its farm plan), the backtest and the audit. The verdict counts
 * come from the same verdictFor the table prints per row, so the strip and
 * the table can never disagree; the reconciliation counts come from the
 * audit rows themselves, never from a hand-kept tally.
 */
export function buildSummary(input: {
  rows: { implied_value_usd: number; farmPlan: FarmPlan }[];
  backtest: BacktestResult;
  audit: AuditRow[];
  liveSetAside: number;
  totalProtocols: number;
}): Summary {
  const verdicts = { farm: 0, marginal: 0, skip: 0 };
  let totalImplied = 0;
  for (const row of input.rows) {
    totalImplied += row.implied_value_usd;
    const v = verdictFor(row.farmPlan).verdict;
    if (v === 'FARM') verdicts.farm++;
    else if (v === 'MARGINAL') verdicts.marginal++;
    else verdicts.skip++;
  }
  const counts = new Map<string, number>();
  for (const a of input.audit) counts.set(a.reason, (counts.get(a.reason) ?? 0) + 1);
  const reasons: ReconciliationReason[] = REASON_ORDER.filter((r) => (counts.get(r) ?? 0) > 0).map((r) => ({
    reason: r,
    count: counts.get(r)!,
  }));
  // Any reason the order above does not name still shows up, after the named
  // ones, so the bar can never silently drop a protocol.
  for (const [reason, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    if (!REASON_ORDER.includes(reason)) reasons.push({ reason, count });
  }
  return {
    ranked: input.rows.length,
    total_implied_usd: totalImplied,
    out_of_sample_miss: input.backtest.median_error_multiple,
    range_holds: input.backtest.range_holds,
    within_2x: input.backtest.within_2x,
    worth_farming: verdicts.farm,
    verdicts,
    reconciliation: {
      total: input.totalProtocols,
      ranked: input.rows.length,
      live_token: input.liveSetAside,
      set_aside: input.audit.length,
      reasons,
    },
  };
}
