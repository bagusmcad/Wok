# Wok

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bagusmcad/Wok/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bagusmcad/Wok/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar: a program that reads a sealed snapshot of the protocol universe and ranks pre-token protocols by implied value, with a farm plan for each — so the next airdrop worth farming shows up early. It writes a ranked board (244 rows: the 40 watchlist protocols, 184 early pre-token protocols below the floor, and 20 more above the floor that the watchlist left out but are launches of their own), a dark dense dashboard (KPI strip, reconciliation bar, clickable per-chain and per-category slice cards that re-slice the whole board and recompute the strip, an out-of-sample rail beside the table, a verdict per row, and a what-if deposit simulator in each protocol's detail view), and a dossier for judging.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

## Signals, risk and the sized farm plan

Three modules sit beside the ranking model and describe each row without changing its rank or implied value:

- `lib/signals.ts` — five per-protocol signals from the snapshot alone: TVL quality against the category median, seven-day momentum, chain breadth, record confidence, and a weighted strength score.
- `lib/risk.ts` — a 0–100 risk score from six named factors (a baseline launch risk every pre-token protocol carries, chain concentration, track record, momentum, book depth, weak signals), banded low / medium / high with a reason per factor. No row scores zero: the baseline alone is 4–8 points, so the top of the board reads Low 4, not Low 0.
- `lib/farmplan.ts` — a sized plan per protocol: capital sized by TVL and trimmed by risk, an expected-value range from the implied value (5% of it split among ~50,000 farmers), a return band, and a hold period.

The board shows the risk band in its own column (sortable, filterable), each row carries its P25–P75 uncertainty band beside the point estimate, and each protocol's detail view carries a bear/bull slider, a risk section and a sized-plan section. All three modules are pure and deterministic, so repeated runs write identical bytes.

## The verdict, the slices, and the what-if simulator

- `lib/summary.ts` — the verdict and the headline numbers. **The verdict rule: net = the plan's middle expected value minus the gas the plan itself charges (setup gas plus $2 a week over the hold); FARM when net ≥ $25, MARGINAL when net ≥ $0, SKIP when net < $0.** On this snapshot that leaves 14 FARM, 16 MARGINAL and 214 SKIP out of 244 rows — a shortlist, not a stampede. The $25 line is a judgment call, not a fit: the smallest net that still buys a farmer's week of attention. The same module sums the board ($3.71B implied over 244 rows) and builds the reconciliation (758 read = 244 ranked + 144 live-token + 370 set aside).
- The dashboard's slice strip shows the six biggest chains and six biggest categories as aggregate cards (count, total implied value, median multiple, top protocol), computed live from the board rows. Clicking one re-slices the whole board and recomputes the KPI strip for that slice — including the backtest numbers, when the slice holds ten or more held-out cases; otherwise the strip marks them global.
- Each protocol's detail view has a what-if simulator: a deposit slider ($25–$1,000) that recomputes the row's EV range, net after gas and ROI multiple for the chosen deposit, with bear/base/bull bars. The assumptions are stated on the page: EV scales with deposit share (the plan's EV is for its own capital, so twice the deposit doubles the EV), gas is the plan's own gas and does not grow with the deposit, so ROI is flat in the deposit — the slider moves the dollars, not the multiple.

## The model (radar-3)

- `lib/model.ts` — the base multiple is calibrated per category on the snapshot's live-token market caps: the median mcap/TVL of the live-token protocols in the category, shrunk toward the global median (0.186 over 133 live-token protocols) with a prior of ten, clamped to 0.05–0.80. Exchanges are left out of the calibration entirely: their rows are never ranked, and one of their ratios is 69.4. Every row also carries a P25–P75 band from the category's quartile ratios.
- `lib/backtest.ts` — leave-one-out validation of the model on the live-token set (see below).
- The audit names every protocol the board sets aside and why: 370 rows — 205 pools of a family whose token already trades, 77 versioned pools, 45 exchanges, and 43 wrapped, staked or bridged products above the floor (WBTC is Bitcoin on Ethereum, not a launch of its own). 272 audit rows name the token symbol as the evidence for the family reason. Together with the 144 live-token protocols, every one of the snapshot's 758 protocols is accounted for: board, live tab, or audit.

## Validation and limitations

The model is validated out of sample, and the numbers are weak in exactly the places a reader should know about. Leave-one-out over the live-token set: each of the 119 live-token protocols outside exchanges with a market cap above zero is held out once, the calibration is refit without it, and the model predicts its market cap as if the token had not launched yet.

- **25.2% of predictions land within twice the actual market cap; 36.1% within three times.**
- **Spearman rank correlation 0.391** — the model ranks directionally, but its point estimates are usually off by a **median 5.25x**.
- **45.4% of held-out market caps land inside the printed P25–P75 band** — near a half, which is what a quartile band should do; the band is a range of what the market has paid per TVL dollar, not a confidence interval.
- **By era, the model has gone stale.** Of the 87 cases that record a listing date, the older half lands within 2x 34.9% of the time (median error 3.24x) and the newer half only 22.7% (median error 5.50x); 32 cases record no date. The market moved on, the multiples did not — a multiple calibrated on yesterday's launches lags, and the board's ranks inherit that lag.
- Best predictions: Symbiosis (1.03x off), Frankencoin (1.03x), Merlin's Seal (1.06x). Worst: Rain (3,380x off — a tiny TVL with a $2.6B market cap), xDAI Stake Bridge (1,902x off — a bridge whose token barely trades), Obol (234x off).
- Treat the implied value as a **ranking signal, not a price**. The board is ordered by it; no single number on it should be read as what a token will trade at.

Limits of the validation itself:

- Sibling pools of one family stay in the calibration while a sibling is held out, so these errors are, if anything, a little optimistic.
- Fourteen live-token protocols record a market cap of zero or less (one records −$1) and are left out of the scored set, because no multiple predicts zero.
- Excluding exchanges from the calibration moves the global median from 0.169 to 0.186. That is a choice, not a fit: exchange rows are never ranked, so their ratios should not set the multiple.
- The shrinkage prior (10 live protocols) and the five-live minimum are kept from the earlier version, not re-fit to the backtest: the backtest was run to report the model, not to tune it to itself.

Decisions the audit makes, stated so they can be disputed:

- **Flying Tulip ftUSD is excluded**: its family token FT already trades through Flying Tulip Lend. **MetalX Swap is excluded** for the same reason (LOAN trades through MetalX Lending). The ten other protocols a rival board drops (alphagrowth, biquid, damm-capital, endurance-bridge, goonfi, inceptionlrt, monarq, nucleus, sophon-bridge, wan-bridge) are **kept**: they are independent protocols, and the only thing that sets them apart is a small TVL — the rival's cut is a tail cut (they are exactly the eleven smallest-TVL early rows), not a quality judgment.
- **Twenty protocols above the floor are ranked even though the watchlist left them out**, including Sentora Curator (#2, $2.8B TVL). The watchlist is a floor, never a ceiling. Wrapped, staked and bridged products above the floor stay out (WBTC, Binance staked ETH, USDT0): they are the token already.
- The snapshot does not carry DefiLlama's parentProtocol, so a sub-product whose parent the house knows and this file does not may still slip onto the board. The audit names what was left out, not what was missed.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ywjptnyy&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
