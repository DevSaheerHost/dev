/**
 * Quotation document: builds the document model from a pricing result, and
 * serialises it to the formats a freelancer actually sends.
 *
 * Every exporter escapes its own user-supplied text — the HTML export is a
 * file that will be opened in a browser, so nothing reaches it unescaped.
 */

import { cleanText, escapeHtml, formatMoney, isoDate, longDate, toNumber } from './util.js';

const DEFAULT_VALID_DAYS = 30;

/**
 * @param {object} result  Output of `calculate()`.
 * @param {object} meta    Sender / recipient / document fields from the form.
 */
export function buildQuote(result, meta = {}) {
  const currency = result.currency;
  const issued = meta.issuedOn || isoDate();
  const validDays = toNumber(meta.validDays, DEFAULT_VALID_DAYS);
  const projectTitle = cleanText(meta.projectTitle, 120) || 'Project quotation';
  const money = (v, decimals = 0) => formatMoney(v, currency, decimals);

  const fee = result.price.mid;
  const taxPct = result.brief.taxPct;
  const taxAmount = result.extras.taxAmount;
  const total = result.extras.grandTotal;

  return {
    number: buildQuoteNumber(issued, projectTitle),
    issued,
    validUntil: isoDate(new Date(`${issued}T00:00:00`), validDays),
    validDays,
    from: {
      name: cleanText(meta.fromName, 80) || 'Your name',
      business: cleanText(meta.fromBusiness, 80),
      email: cleanText(meta.fromEmail, 120),
      location: cleanText(meta.fromLocation, 80)
    },
    to: {
      name: cleanText(meta.clientName, 80) || 'Client name',
      company: cleanText(meta.clientCompany, 80)
    },
    projectTitle,
    summary: cleanText(meta.summary, 900) || result.summary,
    deliverables: Array.isArray(meta.deliverables) ? meta.deliverables : [],
    lines: [
      {
        label: projectTitle,
        detail: `${result.labels.discipline.label} — fixed project fee. Estimated ${Math.round(result.hours.effective)} hours of work, including ${result.brief.revisions === -1 ? 'unlimited revisions' : `${result.hours.rounds} revision round${result.hours.rounds === 1 ? '' : 's'}`} and project administration.`,
        amount: fee
      }
    ],
    optional: [
      { label: 'Additional revision round', amount: result.extras.extraRevision, note: 'Beyond the rounds included above.' },
      { label: 'Additional work, per hour', amount: result.extras.scopeCreepHourly, note: 'Anything outside the deliverables listed, agreed in writing first.' }
    ],
    currency,
    money,
    totals: { fee, taxPct, taxAmount, total, taxLabel: cleanText(meta.taxLabel, 20) || 'Tax' },
    schedule: result.schedule,
    terms: buildTerms(result, meta),
    hours: result.hours,
    rates: result.rates,
    notes: cleanText(meta.notes, 600)
  };
}

function buildQuoteNumber(issued, title) {
  const stamp = issued.replace(/-/g, '').slice(2);
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '') || 'PR';
  return `Q-${stamp}-${initials}`;
}

function buildTerms(result, meta) {
  const c = result.currency;
  const rounds = result.brief.revisions === -1 ? 'unlimited' : String(result.hours.rounds);
  const deposit = result.schedule[0];

  const terms = [
    {
      title: 'What is included',
      body: `Everything listed under deliverables, plus ${rounds} round${rounds === '1' ? '' : 's'} of revisions on the work delivered. Revisions mean refinements to what was agreed, not new directions.`
    },
    {
      title: 'Timeline',
      body: `Approximately ${result.brief.durationWeeks} week${result.brief.durationWeeks === 1 ? '' : 's'} from the start date, assuming feedback within three working days at each review. The schedule starts once the deposit has cleared.`
    },
    {
      title: 'Payment',
      body: `${deposit.pct}% (${c.symbol}${deposit.amount.toLocaleString()}) on signature, balance as scheduled above. Invoices are due within ${toNumber(meta.paymentDays, 14)} days.`
    },
    {
      title: 'Changes to scope',
      body: `Work outside the deliverables above is quoted separately, or billed at ${c.symbol}${result.extras.scopeCreepHourly} per hour, agreed in writing before it starts.`
    },
    {
      title: 'Ownership',
      body: 'Full rights to the final delivered work transfer to the client once the final invoice is paid. Working files and source assets stay with the freelancer unless agreed otherwise.'
    },
    {
      title: 'Validity',
      body: `This quotation is valid for ${toNumber(meta.validDays, DEFAULT_VALID_DAYS)} days from the date of issue.`
    }
  ];

  if (result.labels.urgency.factor >= 1.35) {
    terms.splice(2, 0, {
      title: 'Expedited delivery',
      body: 'This price reflects an accelerated schedule that displaces other booked work. If the start date moves, the fee is re-quoted at standard rates.'
    });
  }

  return terms;
}

/* ------------------------------------------------------------------ *
 * Exporters
 * ------------------------------------------------------------------ */

export function toPlainText(q) {
  const line = (char = '-') => char.repeat(56);
  const out = [];

  out.push('QUOTATION');
  out.push(line('='));
  out.push(`Reference   ${q.number}`);
  out.push(`Issued      ${longDate(q.issued)}`);
  out.push(`Valid until ${longDate(q.validUntil)}`);
  out.push('');
  out.push(`FROM: ${[q.from.name, q.from.business, q.from.email, q.from.location].filter(Boolean).join(' | ')}`);
  out.push(`TO:   ${[q.to.name, q.to.company].filter(Boolean).join(' | ')}`);
  out.push('');
  out.push(`PROJECT: ${q.projectTitle}`);
  out.push(line());
  out.push(wrap(q.summary));
  out.push('');

  if (q.deliverables.length) {
    out.push('DELIVERABLES');
    out.push(line());
    q.deliverables.forEach((d) => out.push(`  - ${d}`));
    out.push('');
  }

  out.push('FEE');
  out.push(line());
  q.lines.forEach((l) => {
    out.push(`  ${l.label}`);
    out.push(wrap(l.detail, '    '));
    out.push(`    ${q.money(l.amount)}`);
  });
  if (q.totals.taxPct > 0) {
    out.push(`  Subtotal                ${q.money(q.totals.fee)}`);
    out.push(`  ${q.totals.taxLabel} (${q.totals.taxPct}%)          ${q.money(q.totals.taxAmount)}`);
  }
  out.push(`  TOTAL                   ${q.money(q.totals.total)}`);
  out.push('');

  out.push('PAYMENT SCHEDULE');
  out.push(line());
  q.schedule.forEach((s) => out.push(`  ${s.label} (${s.pct}%) - ${q.money(s.amount)} - ${s.when}`));
  out.push('');

  out.push('OPTIONAL, IF NEEDED LATER');
  out.push(line());
  q.optional.forEach((o) => out.push(`  ${o.label}: ${q.money(o.amount)} - ${o.note}`));
  out.push('');

  out.push('TERMS');
  out.push(line());
  q.terms.forEach((t) => {
    out.push(`  ${t.title.toUpperCase()}`);
    out.push(wrap(t.body, '    '));
  });

  if (q.notes) {
    out.push('');
    out.push('NOTES');
    out.push(line());
    out.push(wrap(q.notes, '  '));
  }

  out.push('');
  out.push('ACCEPTANCE');
  out.push(line());
  out.push('  Client signature: ______________________   Date: ____________');
  out.push('');
  return out.join('\n');
}

function wrap(text, indent = '  ', width = 72) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = indent;
  for (const word of words) {
    if (current.length + word.length + 1 > width && current.trim()) {
      lines.push(current);
      current = indent;
    }
    current += (current === indent ? '' : ' ') + word;
  }
  if (current.trim()) lines.push(current);
  return lines.join('\n');
}

export function toMarkdown(q) {
  const out = [];
  out.push(`# Quotation — ${q.projectTitle}`);
  out.push('');
  out.push(`**Reference:** ${q.number}  `);
  out.push(`**Issued:** ${longDate(q.issued)}  `);
  out.push(`**Valid until:** ${longDate(q.validUntil)}`);
  out.push('');
  out.push(`**From:** ${[q.from.name, q.from.business, q.from.email, q.from.location].filter(Boolean).join(' · ')}  `);
  out.push(`**To:** ${[q.to.name, q.to.company].filter(Boolean).join(' · ')}`);
  out.push('');
  out.push('## Summary');
  out.push('');
  out.push(q.summary);

  if (q.deliverables.length) {
    out.push('');
    out.push('## Deliverables');
    out.push('');
    q.deliverables.forEach((d) => out.push(`- ${d}`));
  }

  out.push('');
  out.push('## Fee');
  out.push('');
  out.push('| Item | Amount |');
  out.push('| --- | ---: |');
  q.lines.forEach((l) => out.push(`| **${l.label}** — ${l.detail} | ${q.money(l.amount)} |`));
  if (q.totals.taxPct > 0) {
    out.push(`| Subtotal | ${q.money(q.totals.fee)} |`);
    out.push(`| ${q.totals.taxLabel} (${q.totals.taxPct}%) | ${q.money(q.totals.taxAmount)} |`);
  }
  out.push(`| **Total** | **${q.money(q.totals.total)}** |`);

  out.push('');
  out.push('## Payment schedule');
  out.push('');
  q.schedule.forEach((s) => out.push(`- **${s.label} (${s.pct}%)** — ${q.money(s.amount)} — ${s.when}`));

  out.push('');
  out.push('## Optional, if needed later');
  out.push('');
  q.optional.forEach((o) => out.push(`- **${o.label}** — ${q.money(o.amount)} — ${o.note}`));

  out.push('');
  out.push('## Terms');
  out.push('');
  q.terms.forEach((t) => {
    out.push(`**${t.title}.** ${t.body}`);
    out.push('');
  });

  if (q.notes) {
    out.push('## Notes');
    out.push('');
    out.push(q.notes);
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push('Client signature: ______________________  Date: ____________');
  out.push('');
  return out.join('\n');
}

/** A standalone, printable HTML file. All interpolated text is escaped. */
export function toHtml(q) {
  const e = escapeHtml;
  const contact = [q.from.business, q.from.email, q.from.location].filter(Boolean).map(e).join(' &middot; ');
  const client = [q.to.company, q.to.name].filter(Boolean).map(e).join(' &middot; ');

  const deliverables = q.deliverables.length
    ? `<section><h2>Deliverables</h2><ul>${q.deliverables.map((d) => `<li>${e(d)}</li>`).join('')}</ul></section>`
    : '';

  const taxRows = q.totals.taxPct > 0
    ? `<tr><td>Subtotal</td><td class="num">${e(q.money(q.totals.fee))}</td></tr>
       <tr><td>${e(q.totals.taxLabel)} (${e(String(q.totals.taxPct))}%)</td><td class="num">${e(q.money(q.totals.taxAmount))}</td></tr>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quotation ${e(q.number)} &mdash; ${e(q.projectTitle)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 48px 24px; background: #E9EDEC; color: #10201F;
         font: 15px/1.6 "Iowan Old Style", Georgia, "Times New Roman", serif; }
  .sheet { max-width: 760px; margin: 0 auto; background: #fff; padding: 56px 56px 48px;
           box-shadow: 0 24px 60px rgba(16,32,31,.12); border-top: 5px solid #0C6B66; }
  h1 { font: 700 13px/1.2 ui-sans-serif, system-ui, sans-serif; letter-spacing: .22em;
       text-transform: uppercase; color: #0C6B66; margin: 0 0 4px; }
  h2 { font: 700 11px/1.2 ui-sans-serif, system-ui, sans-serif; letter-spacing: .18em;
       text-transform: uppercase; color: #55676A; margin: 32px 0 10px;
       border-bottom: 1px solid #D2DAD8; padding-bottom: 6px; }
  .title { font-size: 28px; font-weight: 600; margin: 0 0 24px; line-height: 1.25; }
  .meta { display: flex; flex-wrap: wrap; gap: 28px; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
          color: #55676A; border-bottom: 1px solid #D2DAD8; padding-bottom: 20px; }
  .meta b { display: block; color: #10201F; font-weight: 600; letter-spacing: .04em; }
  .parties { display: flex; flex-wrap: wrap; gap: 40px; margin: 24px 0 8px; }
  .parties div { flex: 1 1 220px; }
  .label { font: 600 10px/1.4 ui-sans-serif, system-ui, sans-serif; letter-spacing: .18em;
           text-transform: uppercase; color: #8A9A9B; margin-bottom: 4px; }
  .name { font-weight: 600; font-size: 16px; }
  ul { padding-left: 20px; margin: 0; }
  li { margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px;
          font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
  td { padding: 12px 0; border-bottom: 1px solid #E4EAE8; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums;
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .detail { display: block; color: #55676A; font-size: 12.5px; margin-top: 4px; }
  .total td { border-bottom: none; border-top: 2px solid #10201F; font-weight: 700; font-size: 18px; padding-top: 14px; }
  .total .num { color: #9A6B1F; }
  .terms p { margin: 0 0 12px; font-size: 13.5px; }
  .terms b { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px;
             letter-spacing: .04em; text-transform: uppercase; }
  .sign { margin-top: 40px; padding-top: 24px; border-top: 1px solid #D2DAD8;
          display: flex; gap: 40px; font: 12px ui-sans-serif, system-ui, sans-serif; color: #55676A; }
  .sign div { flex: 1; }
  .rule { height: 1px; background: #10201F; margin-top: 34px; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; padding: 0; max-width: none; }
    @page { margin: 18mm; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <h1>Quotation</h1>
    <p class="title">${e(q.projectTitle)}</p>
    <div class="meta">
      <span><b>${e(q.number)}</b>Reference</span>
      <span><b>${e(longDate(q.issued))}</b>Issued</span>
      <span><b>${e(longDate(q.validUntil))}</b>Valid until</span>
    </div>
    <div class="parties">
      <div><p class="label">From</p><p class="name">${e(q.from.name)}</p><p>${contact}</p></div>
      <div><p class="label">Prepared for</p><p class="name">${e(q.to.name)}</p><p>${client}</p></div>
    </div>
    <section><h2>Summary</h2><p>${e(q.summary)}</p></section>
    ${deliverables}
    <section>
      <h2>Fee</h2>
      <table>
        ${q.lines.map((l) => `<tr><td><b>${e(l.label)}</b><span class="detail">${e(l.detail)}</span></td><td class="num">${e(q.money(l.amount))}</td></tr>`).join('')}
        ${taxRows}
        <tr class="total"><td>Total</td><td class="num">${e(q.money(q.totals.total))}</td></tr>
      </table>
    </section>
    <section>
      <h2>Payment schedule</h2>
      <table>
        ${q.schedule.map((s) => `<tr><td><b>${e(s.label)} (${e(String(s.pct))}%)</b><span class="detail">${e(s.when)}</span></td><td class="num">${e(q.money(s.amount))}</td></tr>`).join('')}
      </table>
    </section>
    <section>
      <h2>Optional, if needed later</h2>
      <table>
        ${q.optional.map((o) => `<tr><td><b>${e(o.label)}</b><span class="detail">${e(o.note)}</span></td><td class="num">${e(q.money(o.amount))}</td></tr>`).join('')}
      </table>
    </section>
    <section class="terms">
      <h2>Terms</h2>
      ${q.terms.map((t) => `<p><b>${e(t.title)}.</b> ${e(t.body)}</p>`).join('')}
      ${q.notes ? `<p><b>Notes.</b> ${e(q.notes)}</p>` : ''}
    </section>
    <div class="sign">
      <div><div class="rule"></div>Client signature</div>
      <div><div class="rule"></div>Date</div>
    </div>
  </div>
</body>
</html>`;
}

/** The brief itself, so a quote can be reopened and re-priced later. */
export function toJson(brief, meta) {
  return JSON.stringify({ version: 1, savedAt: new Date().toISOString(), brief, meta }, null, 2);
}
