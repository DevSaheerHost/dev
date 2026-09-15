/**
 * Quotient — application controller.
 *
 * Owns the DOM: reads the two forms into one flat state object, hands the
 * pricing half to the engine and the document half to the quotation builder,
 * then paints the results. All user text reaches the page as text nodes, never
 * as markup.
 */

import {
  CLIENT_TYPES, CURRENCIES, DISCIPLINES, EXPERIENCE, MARKETS,
  REVISION_OPTIONS, SCOPE_CLARITY, URGENCY,
  calculate, detectSignals, suggestedComplexity
} from './engine.js';
import { buildQuote, toHtml, toJson, toMarkdown, toPlainText } from './quote.js';
import * as store from './storage.js';
import {
  clamp, cleanText, el, empty, formatMoney, formatNumber, isoDate, longDate,
  safeFilename, setText, toLines, toNumber
} from './util.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ *
 * Opening state — a real brief, so the page shows working numbers.
 * ------------------------------------------------------------------ */

const EXAMPLE = {
  projectTitle: 'Booking site for a dive school',
  description: 'Five-page site for our dive centre with online course booking and card payments, a trip calendar the team can edit themselves, and everything in English and Norwegian. It has to be live before the season starts in April.',
  deliverables: 'Five-page responsive website\nOnline course booking with card payments\nTrip calendar the team edits themselves\nEnglish and Norwegian throughout\nHandover session and a training call',
  discipline: 'web-dev',
  clientName: 'Marta Nilsen',
  clientCompany: 'Blue Reef Diving',
  clientType: 'smb',
  market: 'nordics',
  currency: 'USD',
  fxRate: 1,
  effortValue: 90,
  effortUnit: 'hours',
  durationWeeks: 6,
  hoursPerDay: 7,
  revisions: 2,
  complexity: 3,
  urgency: 'tight',
  clarity: 'clear',
  experience: 'established',
  floorEnabled: false,
  targetMonthlyIncome: 3200,
  monthlyCosts: 600,
  billableHoursPerWeek: 22,
  weeksOffPerYear: 6,
  taxReservePct: 28,
  fromName: '',
  fromBusiness: '',
  fromEmail: '',
  fromLocation: '',
  validDays: 30,
  paymentDays: 14,
  depositPct: 40,
  taxPct: 0,
  taxLabel: 'VAT',
  notes: ''
};

const TEXT_FIELDS = [
  'projectTitle', 'description', 'deliverables', 'clientName', 'clientCompany',
  'fromName', 'fromBusiness', 'fromEmail', 'fromLocation', 'taxLabel', 'notes'
];
const SELECT_FIELDS = ['discipline', 'clientType', 'market', 'currency', 'experience', 'effortUnit'];
const NUMBER_FIELDS = [
  'fxRate', 'effortValue', 'durationWeeks', 'hoursPerDay', 'complexity',
  'targetMonthlyIncome', 'monthlyCosts', 'billableHoursPerWeek', 'weeksOffPerYear',
  'taxReservePct', 'validDays', 'paymentDays', 'depositPct', 'taxPct'
];
const RADIO_GROUPS = { revisions: REVISION_OPTIONS, urgency: URGENCY, clarity: SCOPE_CLARITY };

let latest = null; // { result, quote } — kept for the export buttons

/* ------------------------------------------------------------------ *
 * Building the controls from the engine's own tables
 * ------------------------------------------------------------------ */

function fillSelect(id, items, labelOf = (i) => i.label, valueOf = (i) => i.id) {
  const select = $(id);
  empty(select);
  const groups = new Map();
  for (const item of items) {
    const groupName = item.group || '';
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(item);
  }
  for (const [groupName, groupItems] of groups) {
    const parent = groupName ? el('optgroup', { attrs: { label: groupName } }) : select;
    for (const item of groupItems) {
      parent.appendChild(el('option', { text: labelOf(item), attrs: { value: valueOf(item) } }));
    }
    if (groupName) select.appendChild(parent);
  }
}

function buildSegmented(id, options) {
  const container = $(id);
  empty(container);
  options.forEach((option) => {
    const value = String(option.value ?? option.id ?? option);
    const inputId = `${id}-${value.replace(/[^a-zA-Z0-9-]/g, '')}`;
    const input = el('input', {
      attrs: { type: 'radio', name: id, id: inputId, value }
    });
    const label = el('label', { text: option.short, attrs: { for: inputId, title: option.title || option.short } });
    container.append(input, label);
  });
}

function segmentOptions() {
  return {
    revisions: REVISION_OPTIONS.map((value) => ({
      value,
      short: value === -1 ? '∞' : String(value),
      title: value === -1 ? 'Unlimited revisions' : `${value} round${value === 1 ? '' : 's'} included`
    })),
    urgency: URGENCY.map((u) => ({ value: u.id, short: u.label, title: u.detail })),
    clarity: SCOPE_CLARITY.map((c) => ({ value: c.id, short: c.label, title: c.detail }))
  };
}

function buildControls() {
  fillSelect('discipline', DISCIPLINES);
  fillSelect('clientType', CLIENT_TYPES);
  fillSelect('market', MARKETS);
  fillSelect('experience', EXPERIENCE, (e) => `${e.label} — ${e.detail}`);
  fillSelect('currency', CURRENCIES, (c) => `${c.code} — ${c.label}`, (c) => c.code);

  const segments = segmentOptions();
  buildSegmented('revisions', segments.revisions);
  buildSegmented('urgency', segments.urgency);
  buildSegmented('clarity', segments.clarity);
}

/* ------------------------------------------------------------------ *
 * State <-> DOM
 * ------------------------------------------------------------------ */

function readState() {
  const state = {};
  for (const id of TEXT_FIELDS) state[id] = cleanText($(id).value, $(id).maxLength > 0 ? $(id).maxLength : 2000);
  for (const id of SELECT_FIELDS) state[id] = $(id).value;
  for (const id of NUMBER_FIELDS) state[id] = toNumber($(id).value, EXAMPLE[id]);
  for (const group of Object.keys(RADIO_GROUPS)) {
    const checked = document.querySelector(`input[name="${group}"]:checked`);
    state[group] = checked ? checked.value : String(EXAMPLE[group]);
  }
  state.revisions = toNumber(state.revisions, 2);
  state.floorEnabled = $('floorEnabled').checked;
  return state;
}

function applyState(state) {
  const merged = { ...EXAMPLE, ...state };
  for (const id of TEXT_FIELDS) $(id).value = cleanText(merged[id], 2000);
  for (const id of SELECT_FIELDS) {
    const select = $(id);
    const hasOption = Array.from(select.options).some((o) => o.value === merged[id]);
    select.value = hasOption ? merged[id] : EXAMPLE[id];
  }
  for (const id of NUMBER_FIELDS) $(id).value = String(toNumber(merged[id], EXAMPLE[id]));
  for (const group of Object.keys(RADIO_GROUPS)) {
    const value = String(merged[group]);
    const input = document.querySelector(`input[name="${group}"][value="${CSS.escape(value)}"]`)
      || document.querySelector(`input[name="${group}"][value="${CSS.escape(String(EXAMPLE[group]))}"]`);
    if (input) input.checked = true;
  }
  $('floorEnabled').checked = Boolean(merged.floorEnabled);
}

function toBrief(state) {
  return {
    discipline: state.discipline,
    experience: state.experience,
    market: state.market,
    clientType: state.clientType,
    urgency: state.urgency,
    clarity: state.clarity,
    complexity: state.complexity,
    effortValue: state.effortValue,
    effortUnit: state.effortUnit,
    hoursPerDay: state.hoursPerDay,
    durationWeeks: state.durationWeeks,
    revisions: state.revisions,
    currency: state.currency,
    fxRate: state.fxRate,
    taxPct: state.taxPct,
    depositPct: state.depositPct,
    floor: {
      enabled: state.floorEnabled,
      monthlyCosts: state.monthlyCosts,
      targetMonthlyIncome: state.targetMonthlyIncome,
      billableHoursPerWeek: state.billableHoursPerWeek,
      weeksOffPerYear: state.weeksOffPerYear,
      taxReservePct: state.taxReservePct
    }
  };
}

function toMeta(state) {
  return {
    projectTitle: state.projectTitle,
    deliverables: toLines(state.deliverables),
    clientName: state.clientName,
    clientCompany: state.clientCompany,
    fromName: state.fromName,
    fromBusiness: state.fromBusiness,
    fromEmail: state.fromEmail,
    fromLocation: state.fromLocation,
    validDays: clamp(state.validDays, 1, 180),
    paymentDays: clamp(state.paymentDays, 0, 120),
    taxLabel: state.taxLabel,
    notes: state.notes,
    issuedOn: isoDate()
  };
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function render() {
  const state = readState();
  const result = calculate(toBrief(state));
  const quote = buildQuote(result, toMeta(state));
  latest = { state, result, quote };

  renderFormFeedback(state, result);
  renderPanel(result);
  renderWaterfall(result);
  renderInsights(result);
  renderSheet(quote);

  persist(state);
}

function renderFormFeedback(state, result) {
  const currency = result.currency;

  // Currency: the FX field only matters when the quote is not in USD.
  $('fxField').hidden = state.currency === 'USD';

  // Scope signals read out of the description.
  const signals = detectSignals(state.description);
  const box = $('signals');
  empty(box);
  if (signals.length) {
    signals.forEach((signal) => {
      const chip = el('span', { className: 'signal', attrs: { title: signal.note } });
      chip.append(el('b', { text: signal.label }));
      box.appendChild(chip);
    });
  } else if (state.description.length > 8) {
    box.appendChild(el('span', { className: 'signals-empty', text: 'No scope signals found — a fuller brief reads better.' }));
  }

  const suggestion = suggestedComplexity(signals);
  const suggestionLine = $('complexitySuggestion');
  if (signals.length && suggestion !== Math.round(state.complexity)) {
    empty(suggestionLine);
    suggestionLine.append(
      document.createTextNode(`The brief reads as level ${suggestion}: ${signals.slice(0, 3).map((s) => s.label.toLowerCase()).join(', ')}. `)
    );
    const apply = el('button', { className: 'btn btn-sm btn-ghost', text: `Set to ${suggestion}`, attrs: { type: 'button', id: 'applyComplexity' } });
    apply.addEventListener('click', () => {
      $('complexity').value = String(suggestion);
      render();
    });
    suggestionLine.appendChild(apply);
  } else {
    setText(suggestionLine, signals.length ? 'Complexity matches what the brief describes.' : '');
  }

  const complexity = result.labels.complexity;
  const valueBox = $('complexityValue');
  empty(valueBox);
  valueBox.append(
    document.createTextNode(`${complexity.value} · ${complexity.label}`),
    el('span', { text: complexity.detail })
  );

  setText($('urgencyHint'), result.labels.urgency.detail);
  setText($('clarityHint'), `${result.labels.clarity.detail} — widens the range to ${Math.round(result.band.spread * 100)}%.`);
  setText($('experienceHint'), `${Math.round(result.labels.experience.factor * 100)}% of the established rate for ${result.labels.discipline.label.toLowerCase()}.`);
  setText($('paceHint'), `${formatNumber(result.hours.perWeek, 1)} billable hours a week at this timeline.`);
  setText($('revisionsLabel'), state.revisions === -1 ? 'Revision rounds included — unlimited' : 'Revision rounds included');

  $('floorFields').hidden = !state.floorEnabled;
  setText($('mobilePrice'), formatMoney(result.price.mid, currency));
}

function renderPanel(result) {
  const c = result.currency;
  setText($('priceLow'), formatMoney(result.price.low, c));
  setText($('priceHigh'), formatMoney(result.price.high, c));
  setText($('priceMid'), formatMoney(result.price.mid, c));
  setText($('confidence'), `${result.band.confidence} confidence`);
  setText($('hourlyReal'), formatMoney(result.rates.quoted, c));
  setText($('dayRate'), formatMoney(result.rates.day, c));
  setText($('effectiveHours'), `${formatNumber(result.hours.effective, 0)} h`);
  setText($('summary'), result.summary);
  setText($('waterfallTotal'), formatMoney(result.price.mid, c));
}

function renderWaterfall(result) {
  const c = result.currency;
  const box = $('waterfall');
  empty(box);

  result.waterfall.forEach((step) => {
    const row = el('div', { className: `wf-row ${step.kind}` });
    const label = el('span', { className: 'wf-label' });
    label.append(document.createTextNode(step.label));
    if (typeof step.percent === 'number' && step.percent !== 0) {
      label.append(el('span', { className: 'num', text: `  ${step.percent > 0 ? '+' : ''}${step.percent}%` }));
    }
    const amount = el('span', {
      className: 'wf-amount',
      text: step.kind === 'base'
        ? formatMoney(step.delta, c)
        : `${step.delta >= 0 ? '+' : '−'}${formatMoney(Math.abs(step.delta), c)}`
    });
    row.append(label, amount, el('span', { className: 'wf-detail', text: step.detail }));
    box.appendChild(row);
  });
}

const TONE_LABEL = { risk: 'Risk', watch: 'Worth a look', good: 'Good to know' };

function renderInsights(result) {
  const box = $('insights');
  empty(box);
  result.insights.forEach((insight) => {
    const card = el('article', { className: `insight ${insight.tone}` });
    card.append(
      el('p', { className: 'tag', text: TONE_LABEL[insight.tone] || 'Note' }),
      el('h4', { text: insight.title }),
      el('p', { text: insight.body })
    );
    box.appendChild(card);
  });
}

/* ------------------------------ The quotation sheet ---------------- */

function sheetSection(title) {
  return el('h3', { text: title });
}

function moneyRow(name, detail, amount, { className = '', bold = false } = {}) {
  const tr = el('tr', { className });
  const td = el('td');
  td.append(el('span', { className: bold ? 'item-name' : '', text: name }));
  if (detail) td.append(el('span', { className: 'item-detail', text: detail }));
  tr.append(td, el('td', { className: 'amount', text: amount }));
  return tr;
}

function renderSheet(q) {
  const sheet = $('sheet');
  empty(sheet);

  sheet.append(el('p', { className: 'eyebrow', text: 'Quotation' }));
  sheet.append(el('h2', { className: 'sheet-title', text: q.projectTitle }));

  const meta = el('div', { className: 'sheet-meta' });
  [
    ['Reference', q.number],
    ['Issued', longDate(q.issued)],
    ['Valid until', longDate(q.validUntil)]
  ].forEach(([label, value]) => {
    const item = el('span');
    item.append(el('b', { text: value }), document.createTextNode(label));
    meta.appendChild(item);
  });
  const stamp = el('span', { className: 'sheet-stamp', text: `${q.money(q.totals.total)} total` });
  meta.appendChild(stamp);
  sheet.appendChild(meta);

  const parties = el('div', { className: 'sheet-parties' });
  const from = el('div');
  from.append(
    el('p', { className: 'eyebrow', text: 'From' }),
    el('p', { className: 'name', text: q.from.name }),
    el('p', { className: 'meta', text: [q.from.business, q.from.email, q.from.location].filter(Boolean).join(' · ') })
  );
  const to = el('div');
  to.append(
    el('p', { className: 'eyebrow', text: 'Prepared for' }),
    el('p', { className: 'name', text: q.to.company || q.to.name }),
    el('p', { className: 'meta', text: q.to.company ? q.to.name : '' })
  );
  parties.append(from, to);
  sheet.appendChild(parties);

  sheet.append(sheetSection('Summary'), el('p', { text: q.summary }));

  if (q.deliverables.length) {
    sheet.append(sheetSection('Deliverables'));
    const list = el('ul', { className: 'deliverable-list' });
    q.deliverables.forEach((d) => list.appendChild(el('li', { text: d })));
    sheet.appendChild(list);
  }

  sheet.append(sheetSection('Fee'));
  const feeTable = el('table');
  const feeBody = el('tbody');
  q.lines.forEach((line) => feeBody.appendChild(moneyRow(line.label, line.detail, q.money(line.amount), { bold: true })));
  if (q.totals.taxPct > 0) {
    feeBody.appendChild(moneyRow('Subtotal', '', q.money(q.totals.fee), { className: 'subtotal' }));
    feeBody.appendChild(moneyRow(`${q.totals.taxLabel} (${q.totals.taxPct}%)`, '', q.money(q.totals.taxAmount), { className: 'subtotal' }));
  }
  feeBody.appendChild(moneyRow('Total', '', q.money(q.totals.total), { className: 'total' }));
  feeTable.appendChild(feeBody);
  sheet.appendChild(feeTable);

  sheet.append(sheetSection('Payment schedule'));
  const scheduleTable = el('table');
  const scheduleBody = el('tbody');
  q.schedule.forEach((s) => scheduleBody.appendChild(moneyRow(`${s.label} (${s.pct}%)`, s.when, q.money(s.amount), { bold: true })));
  scheduleTable.appendChild(scheduleBody);
  sheet.appendChild(scheduleTable);

  sheet.append(sheetSection('Optional, if needed later'));
  const optionalTable = el('table');
  const optionalBody = el('tbody');
  q.optional.forEach((o) => optionalBody.appendChild(moneyRow(o.label, o.note, q.money(o.amount), { bold: true })));
  optionalTable.appendChild(optionalBody);
  sheet.appendChild(optionalTable);

  sheet.append(sheetSection('Terms'));
  const terms = el('div', { className: 'terms' });
  q.terms.forEach((t) => {
    const p = el('p');
    p.append(el('b', { text: `${t.title}. ` }), document.createTextNode(t.body));
    terms.appendChild(p);
  });
  if (q.notes) {
    const p = el('p');
    p.append(el('b', { text: 'Notes. ' }), document.createTextNode(q.notes));
    terms.appendChild(p);
  }
  sheet.appendChild(terms);

  const sign = el('div', { className: 'sheet-sign' });
  [['Client signature'], ['Date']].forEach(([label]) => {
    const block = el('div');
    block.append(el('div', { className: 'rule' }), el('span', { text: label }));
    sign.appendChild(block);
  });
  sheet.appendChild(sign);
}

/* ------------------------------------------------------------------ *
 * Exporting
 * ------------------------------------------------------------------ */

function download(filename, mime, content) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = el('a', { attrs: { href: url, download: filename, rel: 'noopener' } });
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportName(extension) {
  const q = latest.quote;
  return `${safeFilename(`${q.number} ${q.projectTitle}`)}.${extension}`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Quotation copied to your clipboard.');
  } catch {
    toast('Copying was blocked. Use Plain text to download it instead.');
  }
}

let toastTimer = 0;
function toast(message) {
  const node = $('toast');
  setText(node, message);
  node.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove('show'), 3200);
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

let saveTimer = 0;
function persist(state) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => store.save('state', state), 400);
}

function restore() {
  const saved = store.load('state');
  applyState(saved && typeof saved === 'object' ? saved : EXAMPLE);
}

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

function currentTheme() {
  const stamped = document.documentElement.getAttribute('data-theme');
  if (stamped === 'dark' || stamped === 'light') return stamped;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function syncThemeButton() {
  const next = currentTheme() === 'dark' ? 'Light' : 'Dark';
  const button = $('themeBtn');
  setText(button, next);
  button.setAttribute('aria-label', `Switch to ${next.toLowerCase()} theme`);
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    window.localStorage.setItem('quotient.v1.theme', next);
  } catch {
    /* preference simply will not persist */
  }
  syncThemeButton();
}

/* ------------------------------------------------------------------ *
 * Importing a saved brief
 * ------------------------------------------------------------------ */

const MAX_IMPORT_BYTES = 256 * 1024;

function importFile(file) {
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    toast('That file is too large to be a saved brief.');
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => toast('That file could not be read.');
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const state = parsed && typeof parsed === 'object' ? parsed.state || parsed.brief : null;
      if (!state || typeof state !== 'object') throw new Error('unrecognised');
      applyState(state);
      render();
      toast('Brief loaded.');
    } catch {
      toast('That is not a Quotient brief file.');
    }
  };
  reader.readAsText(file);
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

function onCurrencyChange() {
  const currency = CURRENCIES.find((c) => c.code === $('currency').value) || CURRENCIES[0];
  $('fxRate').value = String(currency.perUsd);
  render();
}

function wire() {
  ['briefForm', 'docForm'].forEach((formId) => {
    const form = $(formId);
    form.addEventListener('input', (event) => {
      if (event.target && event.target.id === 'currency') return;
      render();
    });
    form.addEventListener('change', (event) => {
      if (event.target && event.target.id === 'currency') onCurrencyChange();
      else render();
    });
    form.addEventListener('submit', (event) => event.preventDefault());
  });

  $('themeBtn').addEventListener('click', toggleTheme);

  $('resetBtn').addEventListener('click', () => {
    if (!window.confirm('Clear this brief and start from the example?')) return;
    store.remove('state');
    applyState(EXAMPLE);
    render();
    toast('Brief reset.');
  });

  $('importBtn').addEventListener('click', () => $('importInput').click());
  $('importInput').addEventListener('change', (event) => {
    importFile(event.target.files && event.target.files[0]);
    event.target.value = '';
  });

  const goToQuote = () => $('quoteSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('toQuoteBtn').addEventListener('click', goToQuote);
  $('mobileQuoteBtn').addEventListener('click', goToQuote);

  $('printBtn').addEventListener('click', () => window.print());
  $('exportPdf').addEventListener('click', () => {
    toast('Choose "Save as PDF" as the destination.');
    window.setTimeout(() => window.print(), 350);
  });
  $('exportHtml').addEventListener('click', () => download(exportName('html'), 'text/html', toHtml(latest.quote)));
  $('exportMarkdown').addEventListener('click', () => download(exportName('md'), 'text/markdown', toMarkdown(latest.quote)));
  $('exportText').addEventListener('click', () => download(exportName('txt'), 'text/plain', toPlainText(latest.quote)));
  $('exportJson').addEventListener('click', () => download(
    `${safeFilename(latest.quote.projectTitle, 'brief')}-brief.json`,
    'application/json',
    toJson(latest.state, toMeta(latest.state))
  ));
  $('copyText').addEventListener('click', () => copyToClipboard(toPlainText(latest.quote)));

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeButton);
}

/* ------------------------------------------------------------------ */

buildControls();
restore();
wire();
syncThemeButton();
render();

if (!store.storageAvailable) {
  toast('Your browser is blocking local storage, so this brief will not be remembered.');
}
