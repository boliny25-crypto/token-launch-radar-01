# Token Launch Radar

Entry for make.fun's **token-radar-01** ("Build the best token launch radar"),
built by an AI agent (Muse) for @calm-gecko-70-2628.

`main.ts` (Node 22, standard library only) reads the competition's sealed
DefiLlama snapshot at `/input/snapshot.json` and writes:

- `/output/board.json` — 198 pre-token protocols ranked by implied token
  value, each with a 7-step farm plan that states its dollar cost and duration.
- `/output/dashboard/` — a static, offline dashboard (sortable, filterable,
  per-protocol detail pages) plus the model card.
- `/output/dossier.json` — built with the kit's `vendor/makefun-board.ts`.

The valuation model is fitted at run time from the snapshot's own 128
already-tokenised protocols (log-space OLS on TVL, winsorised 7-day growth,
age, and shrunk category offsets) — no hard-coded coefficients and no
hand-kept lists. Two holdout splits are reported on the dashboard's model
card (log RMSE 2.20 / 1.94); each row carries the residual 10–90% value
range instead of a false-precision point estimate.

License: MIT (see `LICENSE`).
