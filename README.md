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

## Timeline

A story is an ordered timeline: an opening event (start / opening of a fund, with the first track and an optional
opening amount), then any number of events added with the "+" button: one-off deposit, monthly deposits, withdrawal,
fund transfer, product change, track change, and optional management fees (off by default: % of each deposit and yearly % of accumulated savings, from a chosen date; include them as a "fees" event). Each event can apply to both scenarios, actual only or what-if only,
so the page compares the two and shows total profit over the whole timeline (final value + withdrawals - deposits).
A story can be loaded from a link of the form `index.html#story=<base64url JSON>`; the fragment never leaves the browser.

## Verify against the official sites

The bottom of the result lists every track the money sat in and the exact years for it, with a link to
[Gemel-Net](https://gemelnet.cma.gov.il/views/gemelTsuot.aspx) (gemel/hishtalmut tracks, by fund number) or
[Insurance-Net](https://bituachnet.cma.gov.il/bituachTsuotUI/Tsuot/UI/bituachTsuotUI.aspx) (insurance-policy tracks).
Those systems cannot replay a sequence of track switches, so each phase is checked separately. Their reports are
session-bound (no deep link into a fund+period report; query-string parameters are ignored), so the link opens the
report page where you pick the fund and period yourself. Gemel-Net's minimum report period is 12 months, so a
shorter phase needs a wider window there, and it shows cumulative returns for the period, not a monthly breakdown.

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

## MCP (story builder)

`mcp/server.js` is a zero-dependency stdio MCP server. It only builds and validates story JSON and returns a link
(`#story=...` fragment, never sent to a server) to the site. Nothing is stored, no network access.
Tools: `search_tracks`, `validate_story`, `build_story_link`, `compute_story`.

```
{"mcpServers": {"gemel-what-if": {"command": "node", "args": ["/path/to/gemel-what-if/mcp/server.js"]}}}
```

## Checks

`npm test` runs the unit tests, `npm run e2e` opens the page in headless Chrome with a story in the URL fragment and checks the result and meta tags. CI also runs CodeQL and dependency review, the e2e test checks that every form control has an accessible name, and a weekly workflow (`npm run links`) checks external links. Note on fees: reported yields may already be net of some fees, so a fees event can double count; fee values are user inputs.

## Free-text story (no server)

The "תיאור חופשי עם AI" section builds a prompt from the person's text. They paste it into any AI chat, then paste the JSON reply back. `docs/prompt.js` extracts the JSON and maps `fundName` to a track by search (shown for review). Nothing is sent by the site.

## Worker (remote MCP and AI text box)

`worker/` is a Cloudflare Worker (free plan, no storage, no logging of requests):

- `POST /mcp`: stateless remote MCP (JSON-RPC over HTTP) with the same four tools as the local server. Use it as a custom connector in an MCP client once deployed.
- `POST /api/story`: free text -> Workers AI model with tool calling (`search_tracks`, `validate_story`, `build_story_link`), the answer is validated, and validation errors are fed back up to 2 times. Only the site origin may call it; text is limited to 2,000 characters; 5 requests per hour per IP (best effort, per isolate). Workers AI's free allocation is 10,000 neurons/day, requests fail past it and nothing is billed without a paid plan.

Text sent to the AI endpoint leaves the browser and is processed by Cloudflare Workers AI. Do not include names or ID numbers.

Live Worker: https://gemel-what-if.reihlinstinct.workers.dev (remote MCP connector URL: `https://gemel-what-if.reihlinstinct.workers.dev/mcp`). The site's "בנה עם AI" button calls `/api/story`.

Provider and caps: the AI endpoint uses Google Gemini (`gemini-2.5-flash`, key stored only as the Worker secret `GEMINI_API_KEY`) with at most 100 Gemini calls per day in total (counter in KV, no story data stored) and 5 requests per hour per IP; when the cap is reached or Gemini errors, it falls back to Cloudflare Workers AI. Text typed into the box is sent to Google, so the site warns users not to include names or ID numbers.
