# gemel-what-if

A static, client-side "what if" calculator for Israeli provident funds (קופות גמל, קרנות השתלמות, pension tracks).
Describe an investment story (deposits, dates, the track the money was in) and compare it with a story where you
switched track at a different time. Everything runs in the browser; nothing you type leaves the page.

> **Not financial advice.** Past returns do not predict future returns. Results are a simplified model of reported
> monthly yields, not a statement of any real account.

## Data

Monthly yields come from the Capital Market Authority's open data: [Gemel-Net](https://data.gov.il/dataset/gemelnet)
(provident funds, hishtalmut, pension-type gemel) and [Insurance-Net](https://data.gov.il/dataset/insurance)
(insurance-policy tracks, classes 1990-1991, 1992-2003 and from 2004), 1999 to today. `scripts/fetch_data.py` downloads both datasets and writes `docs/data/funds.json`
(one dense monthly-yield series per track, keyed `g:<id>` for gemel and `i:<id>` for insurance). Data is public and aggregated; no personal data is stored in this repo.

```
python3 scripts/fetch_data.py   # refresh the data
```

## Model

- Deposits arrive at the start of a month and earn that month's yield.
- Balance each month = (balance + deposit) x (1 + monthly yield).
- A track switch moves the whole balance into the new track at the start of the switch month, at no cost.
- Months where the track did not report a yield (for example before it existed) count as 0% and are flagged.
- Reported yields are used as is. Taxes, deposit fees and policy-specific terms are not modelled.
- "Annual return" is the money-weighted (IRR-style) rate over all deposits.

## Product change (niyud) and annuity estimate

A switch event can move money between products, for example from an insurance-policy track to a gemel track,
with two optional inputs: a one-time cost (percent of the balance) and a yearly fee change (percentage points).
When a switch crosses products the page lists what is not modelled (guaranteed annuity coefficient, insurance
coverage, contractual fees, taxes).

The optional annuity module estimates a monthly annuity as `balance / coefficient`, where the coefficient is the
capital needed per 1 NIS of monthly annuity. Money in an insurance track gets the guaranteed coefficient you enter
(from the policy documents, unverified); other money gets the market coefficient you enter. Both coefficients are
user inputs and the result is an estimate only.

## Use

Open `docs/index.html` through any static server (`python3 -m http.server -d docs`) or the hosted page if enabled.
Stories can be saved to and loaded from a local JSON file; they are never uploaded. Keep real stories out of the repo
(`stories/` is git-ignored).

## Develop

```
npm test        # node:test for the engine + unittest for the data builder
```

Layout: `docs/whatif.js` (pure engine), `docs/app.js` (UI), `scripts/` (data), `tests/`.
One issue and one PR per change; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. Data: public-sector open data from data.gov.il.
