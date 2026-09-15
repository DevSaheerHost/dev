# Quotient — freelance pricing & quote studio

A calculator for the question every freelancer gets wrong at least once: *what do I charge for this?*

Describe the project the way the client described it to you, and Quotient returns a defensible
price range, the hourly rate that range actually works out to, a line-by-line explanation of
which parts of the brief moved the number, and a quotation you can send the same afternoon.

Live: <https://saheerlab.vercel.app/freelance-rate-calculator/>

## What it does

| | |
| --- | --- |
| **Price range** | A low / recommended / high band, where the width of the band is a confidence statement — loose scope and less experience widen it. |
| **Hourly equivalent** | What the fixed fee really pays per hour once revisions and admin are counted, plus a day rate. |
| **The reasoning** | A waterfall from the base market rate to the final fee: every factor, its percentage, its money value, and why it applies. |
| **Advice** | Plain-language warnings a good mentor would give — unlimited revisions, a timeline that does not fit the work, quoting under your own cost floor. |
| **Cost floor** | Optional: enter what you need to earn, your business costs, your billable hours and tax reserve, and the app refuses to quote below the rate that covers them. |
| **Quotation** | A real document — reference number, validity, deliverables, fee, payment schedule, optional extras, terms and a signature block. |
| **Export** | Print / Save as PDF, standalone HTML, Markdown, plain text, clipboard, plus a JSON brief you can reopen later. |

## How the number is built

```
raw hours
  + revision hours      (7% of build time per round)
  + admin hours         (10–19%: briefing, email, hand-off, invoicing)
  = billable hours

base rate               (discipline, in USD)
  x experience factor   (0.68 starting out → 1.45 recognised specialist)
  x client market       (0.48 South Asia → 1.18 Nordics — their market, not your rent)
  x complexity          (0.90 → 1.55)
  x urgency             (0.95 → 1.65)
  x scope clarity       (0.97 → 1.20)
  x client type         (0.85 individual → 1.35 enterprise)
  x timeline pressure   (up to 1.25 when the calendar demands 30+ h a week)
  x revision risk       (1.15 when revisions are unlimited)
  = charge rate, floored at your own cost-per-hour if you set one

fee = charge rate x billable hours, with a ± band from the scope clarity
```

The reference tables are quoted in USD and converted with an exchange rate you control, so a
stale FX number can never distort the model itself. They are a defensible starting point, not a
salary survey — the point of the app is that you can see every factor and argue with it.

## Running it

Static files, no build step, no dependencies. The app uses ES modules, so open it through a
server rather than double-clicking `index.html`:

```bash
python3 -m http.server 8000
# then http://localhost:8000/freelance-rate-calculator/
```

## Privacy and security

- No network requests at all: `connect-src 'none'`, no analytics, no fonts beyond Google Fonts' stylesheet.
- A restrictive Content-Security-Policy: scripts and styles from this origin only, no inline script, no framing.
- Every brief stays in `localStorage` on the device. Nothing is uploaded, and there is no account.
- All user text reaches the page as text nodes, and the HTML export escapes every interpolated value.
- Numeric input is clamped to sane ranges before it reaches the model; imported JSON is size-capped and validated.

## Layout

```
index.html          markup and document structure
assets/styles.css   design tokens, light + dark themes, print stylesheet
assets/theme.js     applies the saved theme before first paint
assets/engine.js    pricing model and reference tables — pure functions, no DOM
assets/quote.js     quotation document model and the four exporters
assets/storage.js   defensive localStorage wrapper
assets/app.js       controller: forms, rendering, exports
```
