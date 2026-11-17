// A sized farm plan for each pre-token protocol: how much capital to put in,
// what the position might be worth, and how long to hold it. It builds on the
// ranking model's implied value and on the risk read in lib/risk.ts, but it is
// not the model: the model's farm steps say what to do, this plan says how much
// and what to expect. Pure and deterministic, with no clock, no randomness and
// no network: the same protocol always gets the same plan.
//
// The expected-value maths is stated openly so a reader can argue with it:
// suppose 5% of a token's implied value reaches farmers, split among about
// 50,000 active farmers. One farmer's middle share is then the implied value
// times 0.000001. The plan shows a quarter of that as the low end and two and
// a half times it as the high end, because airdrops are lumpy: most farmers
// get less than the middle, a few get far more.

import type { SnapshotProtocol } from './model.ts';
import type { RiskAssessment } from './risk.ts';
import type { ProtocolSignals } from './signals.ts';

/** How big the position is, after the risk adjustment. */
export type SizeBand = 'small' | 'standard' | 'large';

/** How the middle expected value compares with the capital at risk. */
export type RoiBand = 'modest' | 'solid' | 'strong';

/** The whole sized plan for one protocol. */
export interface FarmPlan {
  sizeBand: SizeBand;
  capitalUsd: number;
  evLowUsd: number;
  evMidUsd: number;
  evHighUsd: number;
  roiMultiple: number;
  roiBand: RoiBand;
  holdDays: number;
  cadence: string;
  rationale: string;
}

/** The share of implied value one farmer's middle outcome represents. */
const FARMER_SHARE = 0.000001;
/** The low end of the expected-value range, as a multiple of the middle. */
const EV_LOW_FACTOR = 0.25;
/** The high end of the expected-value range, as a multiple of the middle. */
const EV_HIGH_FACTOR = 2.5;
/** The number of farmers the 5% pool is assumed to split among. */
export const ASSUMED_FARMERS = 50_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * The starting capital, from locked value alone: bigger protocols can absorb
 * a bigger position without the farmer becoming the market. The tiers are
 * deliberately coarser than the model's own capital bands, so this plan reads
 * as a second opinion rather than a copy of the farm steps.
 */
function baseCapitalFor(protocol: SnapshotProtocol): number {
  if (protocol.tvl_usd >= 1_000_000_000) return 200;
  if (protocol.tvl_usd >= 100_000_000) return 120;
  if (protocol.tvl_usd >= 20_000_000) return 75;
  return 40;
}

/**
 * The risk adjustment: a high-risk protocol gets half the starting capital
 * (never below $25, so the position still qualifies), a medium-risk one gets
 * three quarters, and a low-risk one gets a quarter more.
 */
function riskAdjustedCapital(base: number, risk: RiskAssessment): number {
  if (risk.band === 'high') return Math.max(25, Math.round(base * 0.5));
  if (risk.band === 'medium') return Math.round(base * 0.75);
  return Math.round(base * 1.25);
}

/** The size band a final capital falls in. */
function sizeBandFor(capitalUsd: number): SizeBand {
  if (capitalUsd < 60) return 'small';
  if (capitalUsd < 150) return 'standard';
  return 'large';
}

/** The expected-value range around the middle share of the implied value. */
function expectedValueRange(impliedValueUsd: number): { low: number; mid: number; high: number } {
  const mid = Math.max(1, Math.round(impliedValueUsd * FARMER_SHARE));
  return {
    low: Math.max(1, Math.round(mid * EV_LOW_FACTOR)),
    mid,
    high: Math.round(mid * EV_HIGH_FACTOR),
  };
}

/** The return band from the middle expected value over the capital at risk. */
function roiBandFor(roiMultiple: number): RoiBand {
  if (roiMultiple < 0.5) return 'modest';
  if (roiMultiple < 2) return 'solid';
  return 'strong';
}

/**
 * How long to hold: young protocols need the longest observation, because a
 * snapshot taken weeks after listing says little; older ones need less. A
 * high-risk protocol adds thirty days of watching before the position is
 * judged, and nothing holds longer than four months.
 */
function holdDaysFor(ageDays: number | null, risk: RiskAssessment): number {
  let hold: number;
  if (ageDays === null || ageDays < 180) hold = 90;
  else if (ageDays < 365) hold = 60;
  else hold = 45;
  if (risk.band === 'high') hold += 30;
  return clamp(hold, 30, 120);
}

/**
 * How often to act: weekly for most protocols, but a high-risk one asks for
 * small weekly actions until its record steadies, so no single week commits
 * much.
 */
function cadenceFor(risk: RiskAssessment): string {
  if (risk.band === 'high') return 'One small qualifying action a week; keep each action small until the record steadies.';
  return 'One qualifying action a week, such as a deposit, a borrow, a swap or a vote.';
}

/**
 * The rationale, in one sentence: the size, the return band, and the risk
 * band, with the number that ties them together. It names the inputs, so a
 * reader who disagrees with the sizing can see which input to dispute.
 */
function rationaleFor(
  sizeBand: SizeBand,
  capitalUsd: number,
  roiBand: RoiBand,
  roiMultiple: number,
  risk: RiskAssessment,
  signals: ProtocolSignals,
): string {
  const sizeWord = sizeBand === 'small' ? 'A small' : sizeBand === 'standard' ? 'A standard' : 'A large';
  const returnWord = roiBand === 'modest' ? 'a modest return on the capital' : roiBand === 'solid' ? 'a solid return on the capital' : 'a strong return on the capital';
  return (
    `${sizeWord} $${capitalUsd} position fits a ${risk.band}-risk protocol (risk ${risk.score}/100, ` +
    `strength ${signals.strength}/100): the middle expected value is ${roiMultiple}x the capital, ${returnWord}.`
  );
}

/**
 * The whole plan for one protocol: capital sized by TVL and trimmed by risk,
 * an expected-value range from the implied value, a return band from the
 * middle of that range over the capital, and a hold that grows younger and
 * riskier the protocol is.
 */
export function buildFarmPlan(
  protocol: SnapshotProtocol,
  ageDays: number | null,
  impliedValueUsd: number,
  risk: RiskAssessment,
  signals: ProtocolSignals,
): FarmPlan {
  const capitalUsd = riskAdjustedCapital(baseCapitalFor(protocol), risk);
  const sizeBand = sizeBandFor(capitalUsd);
  const ev = expectedValueRange(impliedValueUsd);
  const roiMultiple = Math.round((ev.mid / capitalUsd) * 100) / 100;
  const roiBand = roiBandFor(roiMultiple);
  const holdDays = holdDaysFor(ageDays, risk);
  const cadence = cadenceFor(risk);
  const rationale = rationaleFor(sizeBand, capitalUsd, roiBand, roiMultiple, risk, signals);
  return {
    sizeBand,
    capitalUsd,
    evLowUsd: ev.low,
    evMidUsd: ev.mid,
    evHighUsd: ev.high,
    roiMultiple,
    roiBand,
    holdDays,
    cadence,
    rationale,
  };
}

/** A one-line read of a plan for the board's Farm column tooltip. */
export function planSummary(plan: FarmPlan): string {
  return `$${plan.capitalUsd} ${plan.sizeBand} position, hold ${plan.holdDays} days, expected $${plan.evLowUsd}–$${plan.evHighUsd} (${plan.roiBand} ROI).`;
}
