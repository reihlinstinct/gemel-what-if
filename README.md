# gemel-what-if

[![CI](https://github.com/reihlinstinct/gemel-what-if/actions/workflows/ci.yml/badge.svg)](https://github.com/reihlinstinct/gemel-what-if/actions/workflows/ci.yml)

A static, client-side "what if" calculator for Israeli provident funds (קופות גמל, קרנות השתלמות, pension tracks).
Describe an investment story (deposits, dates, the track the money was in) and compare it with a story where you
switched track at a different time. Everything runs in the browser; nothing you type leaves the page.

> **Not financial advice.** Past returns do not predict future returns. Results are a simplified model of reported
> monthly yields, not a statement of any real account.

## Languages

All page text lives in `docs/i18n/strings.json`, which is also the only list of languages. Each language is one
block under `languages`: its own name (shown in the picker), `dir`, `locale` (number format and `og:locale`) and
`status` (`source` for the default, Hebrew; `machine-draft` until a native speaker has reviewed it). Every key under
`strings` has one value per language. Adding a language means adding its block and a value for every key; the picker
(`?lang=<code>`, hidden while there is only one language), `<html lang dir>` and the tests all read the catalog.
French is available as a machine draft, with a visible notice pending native-speaker review.
The Hebrew text stays baked into `docs/index.html` for crawlers and readers without JavaScript, and
`tests/i18n.test.js` keeps it equal to the catalog. Not translated: fund, track and company names (they are data),
the search aliases, the AI prompt and the MCP tool descriptions.

## Data

Monthly yields come from the Capital Market Authority's open data: [Gemel-Net](https://data.gov.il/dataset/gemelnet)
(provident funds, hishtalmut, pension-type gemel) and [Insurance-Net](https://data.gov.il/dataset/insurance)
(insurance-policy tracks, classes 1990-1991, 1992-2003 and from 2004), plus
[PensionNet](https://data.gov.il/he/datasets/cma/pensia-net/6d47d6b5-cb08-488b-b333-f1e717b1e1bd)
(pension investment tracks). The Gemel/insurance series extend back to 1999 where reported;
the bundled PensionNet series begin in October 2011. Individual track coverage varies. `scripts/fetch_data.py` downloads all three sources and writes
`docs/data/funds.json` plus the lossless `docs/data/pension.json` array shard. Browser, MCP and Worker
validate and assemble their fund arrays into the same catalog; each file stays below the existing 2 MiB guard.
A generated `data/catalog.json` digest manifest lets the browser reject missing, invalid or mixed-version
shards instead of calculating with a partial catalog. Failed initialization is visible and disables calculation.
Undated legacy Gemel/insurance stories keep the latest legacy month, even when pension reports later.
New undated mixed-product stories use the earlier source-group endpoint; explicit end dates are unchanged.
There is one dense monthly-yield series per track, keyed `g:<id>` for gemel, `i:<id>` for insurance and
`p:<id>` for pension. Data is public and aggregated; no personal data is stored in this repo.

```
python3 scripts/fetch_data.py   # refresh the data
```

## Track selection

Company names and product words constrain search results. A company name or a broad track
word is not a unique track selection. Name-only JSON is resolved only when one match remains;
otherwise select the intended track explicitly. The picker does not auto-select an ambiguous
first result. English company aliases follow the same rules. Explicit valid keys in locally
imported stories remain unchanged. Generated AI keys require the exact key or exact full track
name in the original request, so a ranked model guess cannot silently choose another product.
Names equivalent after whitespace/hyphen normalization remain ambiguous, including legacy/current
siblings with different fees. Company-only results include matching products rather than hiding
legacy products behind the newest source. Both Worker and browser pasted-AI paths check original
text provenance. A single attached Hebrew ב or ל prefix is accepted for a unique full name;
ambiguous names still require an explicit track key or manual selection.

AI-generated fund assignments are proposals, not verified event-to-source bindings. Every generated
start/transfer/product/track event requires its own date-and-track confirmation before calculation.
Both Worker output and pasted AI replies carry this requirement. Editing that event clears its
confirmation. AI-origin provenance remains in exports even after confirmation. Reimport, language
reload and fork/unfork reconstruction reinstate unchecked event confirmations, so a later edit cannot
lose the review boundary. Confirmed exports also include a deterministic snapshot of the reviewed
event values. Engine and MCP reject stale confirmation after an external edit to those values.
This is accidental-edit detection, not tamper-proof authentication of a human confirmation.
Exported unconfirmed proposals remain blocked in the engine and MCP; manual or
previously confirmed explicit-key stories do not acquire a new confirmation requirement. This is
an explicit review boundary, not a claim that mention-matching proves chronology.

## Private statement imports

Use the existing **Load from file** input for private JSON stories. Recognized local `context`
is treated as private automatically; `private: true` also protects stories without context.
Language changes and MCP link generation will not re-encode these stories. Export, change
language in a new window and import again instead. No private data belongs in a
repository, issue, screenshot artifact or shared story URL. Imported stories are
not uploaded; live verification sends only public fund IDs to data.gov.il. This is not access control:
a story already present in a full URL remains readable by anyone holding that URL. Blocking later
serialization does not revoke an already shared link or erase browser history.

An optional `context` object accepts `label`, `notes` (an array of strings),
`statementBalance` (number) and `endAdjustment` (signed number). The label and
notes render as plain text. The original statement balance stays separate from
both modeled values. A shared adjustment is applied only to the separate final
summary, not the engine, chart or annualized gross return. The baseline-to-statement
residual is displayed, not silently corrected. Charge timing and demographic
adjustments remain assumptions, not exact account reconstruction. See the
[design and acceptance criteria](tools/design/pensionnet.md).

## Fees

Every track card (start or switch) defaults the annual management fee to the track's official average
(`AVG_ANNUAL_MANAGEMENT_FEE` in the Authority's open data, stored as `fee` in `funds.json`) and the deposit
fee to the track's official average deposit fee (`AVG_DEPOSIT_FEE`, stored as `dfee`), each shown with its
source period and a dataset link. Both fields stay editable: typing overrides the default, clearing a field
models no fee, and tracks with no official average prefill nothing. The default is the *current* average — it
is not evidence of what the fee was throughout the story. The phase deposit fee charges positive deposits
only and stacks with any dated "fees" event, exactly like the phase savings fee (`feeAdjPct`) stacks with the
event's savings fee; dated fee changes stay available through the dedicated fee event.

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
[Insurance-Net](https://bituachnet.cma.gov.il/bituachTsuotUI/Tsuot/UI/bituachTsuotUI.aspx) (insurance-policy tracks),
or [PensionNet](https://pensyanet.cma.gov.il/Home/What) (pension tracks).
Those systems cannot replay a sequence of track switches, so each phase is checked separately. Their reports are
session-bound (no deep link into a fund+period report; query-string parameters are ignored), so the link opens the
report page where you pick the fund and period yourself. Gemel-Net's minimum report period is 12 months, so a
shorter phase needs a wider window there, and it shows cumulative returns for the period, not a monthly breakdown.

In addition, each row runs a live consistency check against the official monthly yield data on
[data.gov.il](https://data.gov.il/dataset/gemelnet) (the Capital Market Authority's open data — the same
upstream this site's local snapshot is built from). The cumulative figure shown there is compounded in the
browser from the official monthly rows; the Authority does not publish a cumulative return for an arbitrary
period. A "match" confirms the site's local data copy is fresh and consistent with its source — it is not an
independent validation of the calculation formula. Only the public fund number is sent; the story stays in the
browser. If the live fetch fails, the manual links above remain the fallback.

## Use

Open `docs/index.html` through any static server (`python3 -m http.server -d docs`) or the hosted page if enabled.
Stories can be saved to and loaded from a local JSON file; they are never uploaded. Keep real stories out of the repo
(`stories/` is git-ignored).

## Develop

```
npm test        # node:test for the engine + unittest for the data builder
```

Layout: `docs/whatif.js` (pure engine), `docs/app.js` (UI), `scripts/` (data), `tests/`.

Every workflow ends with a `Run summary` job that writes a summary to the top of the run page: which jobs ran, their result and duration, what was skipped and why, the commits and files the run changed, and which checks cover those changes (`.github/ci-coverage-map.json` declares the coverage; files matching no mapping are flagged). The script is `scripts/ci/run_summary.py`.
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

`npm test` runs the unit tests, `npm run e2e` opens the page in headless Chrome with a story in the URL fragment and checks the result and meta tags, and `npm run e2e:webkit` runs the same probe in the WebKit engine (Playwright WebKit) - engine-level coverage close to Safari, though not the Safari app itself. CI also runs CodeQL and dependency review, the e2e test checks that every form control has an accessible name, and a weekly workflow (`npm run links`) checks external links. Note on fees: reported yields may already be net of some fees, so a fees event can double count; fee values are user inputs.

## Free-text story (no server)

The "תיאור חופשי עם AI" section builds a prompt from the person's text. They paste it into any AI chat, then paste the JSON reply back. `docs/prompt.js` extracts the JSON, checks proposed keys/names against the original text, and maps `fundName` only when search gives one unambiguous track. Otherwise the person selects the track explicitly. Nothing is sent by the site.

## Worker (remote MCP and AI text box)

`worker/` is a Cloudflare Worker (free plan, no storage, no logging of requests):

- `POST /mcp`: stateless remote MCP (JSON-RPC over HTTP) with the same four tools as the local server. Use it as a custom connector in an MCP client once deployed.
- `POST /api/story`: free text -> Workers AI model with tool calling (`search_tracks`, `validate_story`, `build_story_link`), the answer is validated, and validation errors are fed back up to 2 times. Only the site origin may call it; text is limited to 2,000 characters; 5 requests per hour per IP (best effort, per isolate). Workers AI's free allocation is 10,000 neurons/day, requests fail past it and nothing is billed without a paid plan.

Text sent to the AI endpoint leaves the browser and is processed by Cloudflare Workers AI. Do not include names or ID numbers.

Live Worker: https://gemel-what-if.reihlinstinct.workers.dev (remote MCP connector URL: `https://gemel-what-if.reihlinstinct.workers.dev/mcp`). The site's "בנה עם AI" button calls `/api/story`.

Provider and caps: the AI endpoint uses Google Gemini (`gemini-2.5-flash`, key stored only as the Worker secret `GEMINI_API_KEY`) with at most 100 Gemini calls per day in total (counter in KV, no story data stored) and 5 requests per hour per IP; when the cap is reached or Gemini errors, it falls back to Cloudflare Workers AI. Text typed into the box is sent to Google, so the site warns users not to include names or ID numbers.

## Accessibility engineering gate

The [accessibility statement](ACCESSIBILITY.md) records evidence and manual gaps.
A pinned shared axe/Playwright action tests local synthetic previews in both
catalog languages, desktop/mobile widths and Chromium/WebKit. Calculation and
open-statement states get additional scans. Passing automation is not a full
SI 5568 or WCAG conformance claim; see issue #109 for the pilot.
