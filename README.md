# Wok

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bagusmcad/Wok/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bagusmcad/Wok/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar: a program that reads a sealed snapshot of the protocol universe and ranks pre-token protocols by implied value, with a farm plan for each — so the next airdrop worth farming shows up early. It writes a ranked board (226 rows: the 40 watchlist protocols plus 186 early pre-token protocols), a dashboard with spotlight cards, chain and scope filters, and a dossier for judging.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

## Signals, risk and the sized farm plan

Three modules sit beside the ranking model and describe each row without changing its rank or implied value:

- `lib/signals.ts` — five per-protocol signals from the snapshot alone: TVL quality against the category median, seven-day momentum, chain breadth, record confidence, and a weighted strength score.
- `lib/risk.ts` — a 0–100 risk score from five named factors (chain concentration, track record, momentum, book depth, weak signals), banded low / medium / high with a reason per factor.
- `lib/farmplan.ts` — a sized plan per protocol: capital sized by TVL and trimmed by risk, an expected-value range from the implied value (5% of it split among ~50,000 farmers), a return band, and a hold period.

The board shows the risk band in its own column (sortable, filterable), and each protocol's detail view carries a risk section and a sized-plan section. All three modules are pure and deterministic, so repeated runs write identical bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ywjptnyy&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
