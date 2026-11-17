// A risk read on each pre-token protocol, built only from the sealed snapshot's
// figures and the signals in lib/signals.ts. The score runs 0 to 100 and higher
// means riskier; every point comes from a named factor, and the assessment keeps
// the reasons alongside the number so the board can show its working. Pure and
// deterministic: the same protocol always scores the same, with no clock, no
// randomness and no network. Risk never changes a row's rank or implied value.

import type { SnapshotProtocol } from './model.ts';
import type { ProtocolSignals } from './signals.ts';

/** The three bands the board shows, from the score's cut points. */
export type RiskBand = 'low' | 'medium' | 'high';

/** A protocol's whole risk read: the score, its band, and why. */
export interface RiskAssessment {
  score: number;
  band: RiskBand;
  reasons: string[];
}

/** A single point of risk: how much it adds and the sentence that explains it. */
interface RiskFactor {
  points: number;
  reason: string;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The band a score falls in: under 30 is low, under 60 is medium, the rest high. */
export function bandFor(score: number): RiskBand {
  if (score < 30) return 'low';
  if (score < 60) return 'medium';
  return 'high';
}

/** A one-word label for a band, for the board's Risk column. */
export function bandLabel(band: RiskBand): string {
  if (band === 'low') return 'Low';
  if (band === 'medium') return 'Medium';
  return 'High';
}

/**
 * Concentration risk: a protocol on one chain leans on one network's uptime,
 * fees and bridge, so it pays the most; each extra chain up to four spreads
 * that exposure, and five or more pay nothing.
 */
function concentrationFactor(protocol: SnapshotProtocol): RiskFactor | null {
  const n = protocol.chains.length;
  if (n <= 1) return { points: 25, reason: 'Runs on a single chain, so one network outage or bridge fault reaches the whole position.' };
  if (n === 2) return { points: 12, reason: 'Runs on two chains, so most of the position still leans on one network.' };
  if (n <= 4) return { points: 5, reason: 'Runs on a few chains, with some concentration left.' };
  return null;
}

/**
 * Track-record risk: age is the only proof a protocol has survived, so a
 * missing listing date is the worst case, a protocol younger than ninety days
 * is still unproven, and one under a year is only partly proven.
 */
function trackRecordFactor(ageDays: number | null): RiskFactor | null {
  if (ageDays === null) return { points: 20, reason: 'No listing date on record, so the protocol has no proven track record to judge.' };
  if (ageDays < 90) return { points: 15, reason: 'Listed less than ninety days ago, so its record is too short to have survived a bad market.' };
  if (ageDays < 365) return { points: 8, reason: 'Listed less than a year ago, so its record covers only part of a market cycle.' };
  return null;
}

/**
 * Momentum risk: a sharp seven-day fall is the clearest warning, a missing
 * change leaves the reader blind, and a parabolic rise can unwind as fast as
 * it came. Flat or gently rising protocols pay nothing here.
 */
function momentumFactor(protocol: SnapshotProtocol): RiskFactor | null {
  if (protocol.change_7d === null) return { points: 10, reason: 'No seven-day change reported, so recent direction is unknown.' };
  if (protocol.change_7d < -20) return { points: 20, reason: `TVL fell ${Math.abs(protocol.change_7d).toFixed(1)}% in seven days, a sharp drawdown.` };
  if (protocol.change_7d < -5) return { points: 8, reason: `TVL fell ${Math.abs(protocol.change_7d).toFixed(1)}% in seven days.` };
  if (protocol.change_7d > 150) return { points: 12, reason: `TVL rose ${protocol.change_7d.toFixed(0)}% in seven days, a pace that can unwind as fast as it came.` };
  return null;
}

/**
 * Thin-book risk: under $10M of locked value a protocol's own markets are
 * shallow, so entering and leaving both cost more and a single large holder
 * moves the price.
 */
function thinBookFactor(protocol: SnapshotProtocol): RiskFactor | null {
  if (protocol.tvl_usd < 10_000_000) {
    return { points: 10, reason: 'Under $10M of TVL, so its markets are shallow and a single holder moves them.' };
  }
  return null;
}

/**
 * Weak-signal risk: a protocol that scores weak against its own category on
 * size, growth and breadth together has less standing behind its implied
 * value than the number alone suggests.
 */
function weakSignalFactor(signals: ProtocolSignals): RiskFactor | null {
  if (signals.strength < 35) {
    return { points: 10, reason: `Weak category-relative strength (${signals.strength}/100), so little behind the implied value but the TVL itself.` };
  }
  return null;
}

/**
 * The full assessment: add every factor that fires, cap the total at 100, and
 * keep the reasons in the order the factors fired. A protocol with no factor
 * firing gets one clean-bill sentence instead of an empty list.
 */
export function assessRisk(
  protocol: SnapshotProtocol,
  ageDays: number | null,
  _impliedValueUsd: number,
  signals: ProtocolSignals,
): RiskAssessment {
  void _impliedValueUsd;
  const factors: (RiskFactor | null)[] = [
    concentrationFactor(protocol),
    trackRecordFactor(ageDays),
    momentumFactor(protocol),
    thinBookFactor(protocol),
    weakSignalFactor(signals),
  ];
  const fired = factors.filter((f): f is RiskFactor => f !== null);
  const score = clamp(
    fired.reduce((sum, f) => sum + f.points, 0),
    0,
    100,
  );
  const reasons =
    fired.length > 0
      ? fired.map((f) => f.reason)
      : ['No single risk factor stands out: spread across chains, with a record and a steady seven days.'];
  return { score, band: bandFor(score), reasons };
}

/**
 * A one-line risk read for the board's Risk column: the band, the score, and
 * the first reason, so the column stays readable at a glance.
 */
export function riskSummary(assessment: RiskAssessment): string {
  return `${bandLabel(assessment.band)} risk (${assessment.score}/100): ${assessment.reasons[0]!}`;
}
