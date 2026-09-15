/**
 * Pricing engine.
 *
 * Pure functions only: `calculate(brief)` takes a validated brief and returns
 * a result object. No DOM, no storage, no network — which makes the model
 * easy to reason about and to test.
 *
 * Model, in one line:
 *   effective hours x (base rate x experience x client market x risk factors)
 *
 * All internal maths happens in USD, because the reference rate tables are
 * quoted in USD. Every figure is converted with the user's own FX rate on the
 * way out, so a stale exchange rate can never distort the model itself.
 */

import { clamp, toNumber } from './util.js';

/* ------------------------------------------------------------------ *
 * Reference tables
 * ------------------------------------------------------------------ */

export const CURRENCIES = [
  { code: 'USD', symbol: '$', label: 'US Dollar', perUsd: 1 },
  { code: 'EUR', symbol: '€', label: 'Euro', perUsd: 0.92 },
  { code: 'GBP', symbol: '£', label: 'British Pound', perUsd: 0.79 },
  { code: 'CAD', symbol: '$', label: 'Canadian Dollar', perUsd: 1.36 },
  { code: 'AUD', symbol: '$', label: 'Australian Dollar', perUsd: 1.52 },
  { code: 'INR', symbol: '₹', label: 'Indian Rupee', perUsd: 83 },
  { code: 'AED', symbol: 'د.إ', label: 'UAE Dirham', perUsd: 3.67 },
  { code: 'SGD', symbol: '$', label: 'Singapore Dollar', perUsd: 1.35 },
  { code: 'ZAR', symbol: 'R', label: 'South African Rand', perUsd: 18.5 },
  { code: 'BRL', symbol: 'R$', label: 'Brazilian Real', perUsd: 5.4 },
  { code: 'NGN', symbol: '₦', label: 'Nigerian Naira', perUsd: 1500 },
  { code: 'PHP', symbol: '₱', label: 'Philippine Peso', perUsd: 57 },
  { code: 'PLN', symbol: 'zł', label: 'Polish Złoty', perUsd: 3.95 },
  { code: 'JPY', symbol: '¥', label: 'Japanese Yen', perUsd: 150 }
];

/**
 * Baseline independent-professional hourly rates in USD, at mid experience
 * and a mid-tier client market. These are the anchor the rest of the model
 * moves around, not a promise about any one market.
 */
export const DISCIPLINES = [
  { id: 'web-dev', label: 'Web development', base: 75, group: 'Build' },
  { id: 'frontend', label: 'Frontend / UI engineering', base: 72, group: 'Build' },
  { id: 'backend', label: 'Backend / API engineering', base: 82, group: 'Build' },
  { id: 'mobile', label: 'Mobile app development', base: 85, group: 'Build' },
  { id: 'ecommerce', label: 'E-commerce / Shopify build', base: 70, group: 'Build' },
  { id: 'devops', label: 'DevOps / cloud infrastructure', base: 95, group: 'Build' },
  { id: 'data', label: 'Data engineering / analytics', base: 88, group: 'Build' },
  { id: 'ai', label: 'AI / ML engineering', base: 110, group: 'Build' },
  { id: 'ux', label: 'UX / product design', base: 78, group: 'Design' },
  { id: 'ui-design', label: 'UI / web design', base: 68, group: 'Design' },
  { id: 'brand', label: 'Brand & identity design', base: 72, group: 'Design' },
  { id: 'graphic', label: 'Graphic design', base: 55, group: 'Design' },
  { id: 'illustration', label: 'Illustration', base: 58, group: 'Design' },
  { id: 'motion', label: 'Motion graphics / animation', base: 70, group: 'Media' },
  { id: 'video', label: 'Video editing', base: 55, group: 'Media' },
  { id: 'photo', label: 'Photography', base: 62, group: 'Media' },
  { id: 'audio', label: 'Audio / podcast production', base: 52, group: 'Media' },
  { id: 'copy', label: 'Copywriting', base: 60, group: 'Words' },
  { id: 'content', label: 'Content & SEO writing', base: 52, group: 'Words' },
  { id: 'techwriting', label: 'Technical writing', base: 68, group: 'Words' },
  { id: 'translation', label: 'Translation / localisation', base: 48, group: 'Words' },
  { id: 'seo', label: 'SEO / growth marketing', base: 70, group: 'Growth' },
  { id: 'social', label: 'Social media management', base: 45, group: 'Growth' },
  { id: 'ads', label: 'Paid ads / performance', base: 75, group: 'Growth' },
  { id: 'consulting', label: 'Consulting / strategy', base: 105, group: 'Advisory' },
  { id: 'pm', label: 'Project / product management', base: 72, group: 'Advisory' },
  { id: 'va', label: 'Virtual assistance / ops', base: 32, group: 'Advisory' }
];

export const EXPERIENCE = [
  { id: 'starting', label: 'Just starting out', detail: 'Under 1 year, first paid clients', factor: 0.68 },
  { id: 'growing', label: 'Growing', detail: '1–3 years, a small portfolio', factor: 0.85 },
  { id: 'established', label: 'Established', detail: '3–7 years, steady referrals', factor: 1 },
  { id: 'senior', label: 'Senior', detail: '7–12 years, leads projects end to end', factor: 1.22 },
  { id: 'specialist', label: 'Recognised specialist', detail: 'Known for one niche, clients come to you', factor: 1.45 }
];

/**
 * Client market, not your own location. Rates follow the budget the work is
 * being bought from — this is the single field freelancers most often get
 * wrong by pricing to their own cost of living instead.
 */
export const MARKETS = [
  { id: 'us', label: 'United States / Canada', factor: 1.15 },
  { id: 'uk', label: 'United Kingdom / Ireland', factor: 1.05 },
  { id: 'nordics', label: 'Nordics / Switzerland', factor: 1.18 },
  { id: 'weu', label: 'Western Europe', factor: 1.02 },
  { id: 'seu', label: 'Southern Europe', factor: 0.84 },
  { id: 'eeu', label: 'Eastern Europe', factor: 0.7 },
  { id: 'anz', label: 'Australia / New Zealand', factor: 1.08 },
  { id: 'gulf', label: 'Gulf / Middle East', factor: 0.95 },
  { id: 'latam', label: 'Latin America', factor: 0.62 },
  { id: 'sasia', label: 'South Asia', factor: 0.48 },
  { id: 'seasia', label: 'Southeast Asia', factor: 0.55 },
  { id: 'easia', label: 'East Asia', factor: 0.9 },
  { id: 'africa', label: 'Africa', factor: 0.55 }
];

export const CLIENT_TYPES = [
  { id: 'individual', label: 'Individual / solo founder', factor: 0.85, deposit: 50 },
  { id: 'startup', label: 'Early-stage startup', factor: 0.95, deposit: 45 },
  { id: 'smb', label: 'Small business', factor: 1, deposit: 40 },
  { id: 'agency', label: 'Agency (white-label)', factor: 1.08, deposit: 35 },
  { id: 'scaleup', label: 'Funded scale-up', factor: 1.18, deposit: 35 },
  { id: 'enterprise', label: 'Enterprise / public sector', factor: 1.35, deposit: 30 }
];

export const COMPLEXITY = [
  { value: 1, label: 'Routine', detail: 'You have shipped this exact thing before', factor: 0.9 },
  { value: 2, label: 'Familiar', detail: 'Known territory, a few new pieces', factor: 1 },
  { value: 3, label: 'Involved', detail: 'Several moving parts to hold together', factor: 1.15 },
  { value: 4, label: 'Demanding', detail: 'Integrations, edge cases, real research', factor: 1.32 },
  { value: 5, label: 'Uncharted', detail: 'Nobody has solved this the same way twice', factor: 1.55 }
];

export const URGENCY = [
  { id: 'relaxed', label: 'No fixed deadline', detail: 'Fits around your other work', factor: 0.95 },
  { id: 'standard', label: 'Normal timeline', detail: 'Agreed dates, comfortable pace', factor: 1 },
  { id: 'tight', label: 'Tight', detail: 'Doable, but nothing can slip', factor: 1.15 },
  { id: 'rush', label: 'Rush', detail: 'You push other clients back', factor: 1.35 },
  { id: 'emergency', label: 'Drop everything', detail: 'Nights and weekends', factor: 1.65 }
];

export const SCOPE_CLARITY = [
  { id: 'locked', label: 'Locked down', detail: 'Written spec, decisions made', factor: 0.97, spread: 0.06 },
  { id: 'clear', label: 'Mostly clear', detail: 'Goal is agreed, details to settle', factor: 1, spread: 0.1 },
  { id: 'loose', label: 'Some unknowns', detail: 'A few answers still missing', factor: 1.08, spread: 0.15 },
  { id: 'vague', label: 'Vague', detail: '"We’ll know it when we see it"', factor: 1.2, spread: 0.22 }
];

/** Revision policy. `-1` means unlimited. */
export const REVISION_OPTIONS = [0, 1, 2, 3, 4, 5, -1];

/**
 * Scope signals read out of the project description. They never change a
 * number on their own — they surface as chips the freelancer can accept,
 * because only they know whether the word "payments" meant Stripe checkout
 * or a bank reconciliation engine.
 */
export const SIGNALS = [
  { id: 'payments', label: 'Payments', test: /\b(payments?|stripe|checkout|billing|subscriptions?|paypal|razorpay)\b/i, weight: 1, note: 'Money flows need testing, error states and a security pass.' },
  { id: 'auth', label: 'Accounts & login', test: /\b(log[- ]?in|auth\w*|sign[- ]?ups?|accounts?|sso|oauth|permissions?|roles?)\b/i, weight: 1, note: 'Sessions, resets and permissions are their own mini-project.' },
  { id: 'integration', label: 'Third-party integration', test: /\b(api|apis|integrat\w*|webhooks?|crm|zapier|sync\w*|third[- ]party|erp)\b/i, weight: 1, note: 'You depend on someone else\u2019s docs, limits and downtime.' },
  { id: 'migration', label: 'Migration', test: /\b(migrat\w*|legacy|re[- ]?platform\w*|existing (site|data|content)|move from)\b/i, weight: 1, note: 'Old data is always messier than the brief admits.' },
  { id: 'multilingual', label: 'Multi-language', test: /\b(multi[- ]?lingual|multi[- ]?language|languages?|translat\w*|locali[sz]\w*|i18n|bilingual|rtl)\b/i, weight: 1, note: 'Every screen gets built, reviewed and fixed more than once.' },
  { id: 'ecommerce', label: 'E-commerce', test: /\b(e-?commerce|shops?|stores?|product catalog\w*|carts?|inventory)\b/i, weight: 1, note: 'Catalogue, tax, shipping and order states add real hours.' },
  { id: 'cms', label: 'Client-editable content', test: /\b(cms|admin panel|dashboards?|editable|edits? themselves|wordpress|contentful|sanity)\b/i, weight: 1, note: 'Building for a non-technical editor costs more than hard-coding.' },
  { id: 'realtime', label: 'Real-time / live data', test: /\b(real[- ]?time|live (data|updates?|feed)|websockets?|chat|notifications?|streaming)\b/i, weight: 1, note: 'State that changes under the user is where the bugs live.' },
  { id: 'booking', label: 'Booking / scheduling', test: /\b(book\w*|schedul\w*|calendar|appointments?|reservations?|availability)\b/i, weight: 1, note: 'Availability, time zones and cancellations are all edge cases.' },
  { id: 'animation', label: 'Custom motion', test: /\b(animat\w*|motion|3d|three\.?js|webgl|parallax|interactive)\b/i, weight: 1, note: 'Motion is iterated on until it feels right, not until it works.' },
  { id: 'accessibility', label: 'Accessibility', test: /\b(accessib\w*|wcag|a11y|screen readers?|aria)\b/i, weight: 1, note: 'A real WCAG pass means audit, fixes and a second audit.' },
  { id: 'compliance', label: 'Compliance', test: /\b(gdpr|hipaa|soc ?2|pci|complian\w*|audits?|legal review)\b/i, weight: 1, note: 'Documentation and sign-off cycles, not just code.' },
  { id: 'stakeholders', label: 'Many stakeholders', test: /\b(stakeholders?|committee|board|multiple teams|approvals? from|sign[- ]?off)\b/i, weight: 1, note: 'Each extra approver adds rounds you cannot see yet.' },
  { id: 'research', label: 'Research / discovery', test: /\b(research|discovery|user testing|interviews?|workshops?|audit)\b/i, weight: 1, note: 'Discovery is billable work with its own deliverable.' },
  { id: 'deadline', label: 'Hard deadline', test: /\b(deadline|before (the )?(season|launch|event|conference)|by (the )?end of|asap|urgent\w*|live before)\b/i, weight: 1, note: 'A fixed external date removes your room to absorb surprises.' },
  { id: 'maintenance', label: 'Ongoing support', test: /\b(maintenance|supports?|retainers?|ongoing|monthly|sla)\b/i, weight: 0, note: 'Price this separately as a retainer, not inside the build.' }
];

/* ------------------------------------------------------------------ *
 * Internal helpers
 * ------------------------------------------------------------------ */

const byId = (list, id, fallbackIndex = 0) =>
  list.find((item) => item.id === id) || list[fallbackIndex];

/** Round to a step that reads like a real quote rather than a calculation. */
function roundMoney(value) {
  const v = Math.max(0, toNumber(value, 0));
  if (v >= 100000) return Math.round(v / 1000) * 1000;
  if (v >= 20000) return Math.round(v / 500) * 500;
  if (v >= 5000) return Math.round(v / 100) * 100;
  if (v >= 1000) return Math.round(v / 50) * 50;
  if (v >= 200) return Math.round(v / 25) * 25;
  if (v >= 50) return Math.round(v / 5) * 5;
  return Math.round(v);
}

function roundRate(value) {
  const v = Math.max(0, toNumber(value, 0));
  return v >= 500 ? Math.round(v / 10) * 10 : Math.round(v);
}

/* ------------------------------------------------------------------ *
 * Brief normalisation
 * ------------------------------------------------------------------ */

/** Clamp and default every field, so `calculate` can trust its input. */
export function normaliseBrief(raw = {}) {
  const currency = CURRENCIES.find((c) => c.code === raw.currency) || CURRENCIES[0];
  return {
    discipline: byId(DISCIPLINES, raw.discipline, 0).id,
    experience: byId(EXPERIENCE, raw.experience, 2).id,
    market: byId(MARKETS, raw.market, 0).id,
    clientType: byId(CLIENT_TYPES, raw.clientType, 2).id,
    urgency: byId(URGENCY, raw.urgency, 1).id,
    clarity: byId(SCOPE_CLARITY, raw.clarity, 1).id,
    complexity: clamp(raw.complexity, 1, 5),
    effortValue: clamp(raw.effortValue, 0.5, 4000),
    effortUnit: raw.effortUnit === 'days' ? 'days' : 'hours',
    hoursPerDay: clamp(raw.hoursPerDay, 1, 16),
    durationWeeks: clamp(raw.durationWeeks, 0.2, 104),
    revisions: REVISION_OPTIONS.includes(toNumber(raw.revisions, 2)) ? toNumber(raw.revisions, 2) : 2,
    currency: currency.code,
    fxRate: clamp(raw.fxRate, 0.000001, 1000000),
    floor: {
      enabled: Boolean(raw.floor?.enabled),
      monthlyCosts: clamp(raw.floor?.monthlyCosts, 0, 10000000),
      targetMonthlyIncome: clamp(raw.floor?.targetMonthlyIncome, 0, 10000000),
      billableHoursPerWeek: clamp(raw.floor?.billableHoursPerWeek, 1, 60),
      weeksOffPerYear: clamp(raw.floor?.weeksOffPerYear, 0, 30),
      taxReservePct: clamp(raw.floor?.taxReservePct, 0, 70)
    },
    taxPct: clamp(raw.taxPct, 0, 40),
    depositPct: clamp(raw.depositPct, 0, 100)
  };
}

/* ------------------------------------------------------------------ *
 * The calculation
 * ------------------------------------------------------------------ */

/**
 * @param {object} rawBrief  A brief as collected from the form.
 * @returns {object} Every figure the interface and the quotation need.
 */
export function calculate(rawBrief) {
  const brief = normaliseBrief(rawBrief);
  const currency = CURRENCIES.find((c) => c.code === brief.currency) || CURRENCIES[0];
  const fx = brief.fxRate;
  const money = (usd) => usd * fx;

  const discipline = byId(DISCIPLINES, brief.discipline);
  const experience = byId(EXPERIENCE, brief.experience);
  const market = byId(MARKETS, brief.market);
  const clientType = byId(CLIENT_TYPES, brief.clientType);
  const urgency = byId(URGENCY, brief.urgency);
  const clarity = byId(SCOPE_CLARITY, brief.clarity);
  const complexity = COMPLEXITY.find((c) => c.value === Math.round(brief.complexity)) || COMPLEXITY[1];

  /* --- Hours ------------------------------------------------------ */
  const rawHours = brief.effortUnit === 'days'
    ? brief.effortValue * brief.hoursPerDay
    : brief.effortValue;

  // Revisions consume real hours: roughly 7% of build time per round, and an
  // unlimited policy is modelled as four rounds plus a risk premium later.
  const revisionRounds = brief.revisions === -1 ? 4 : brief.revisions;
  const revisionHours = rawHours * 0.07 * revisionRounds;

  // Briefing calls, emails, hand-off and invoicing. Never zero, and heavier
  // when the scope is loose or the client has many voices.
  const adminRate = 0.1 + (clarity.spread > 0.12 ? 0.04 : 0) + (clientType.id === 'enterprise' ? 0.05 : 0);
  const adminHours = rawHours * adminRate;

  const effectiveHours = rawHours + revisionHours + adminHours;

  /* --- Rate ------------------------------------------------------- */
  const baseRateUsd = discipline.base;
  const marketRateUsd = baseRateUsd * experience.factor * market.factor;

  // Timeline compression: if the calendar forces more than 30 focused hours a
  // week, that is a second job on top of everything else you have booked.
  const hoursPerWeek = effectiveHours / brief.durationWeeks;
  const compressionFactor = hoursPerWeek <= 30
    ? 1
    : clamp(1 + (hoursPerWeek - 30) / 100, 1, 1.25);

  const revisionFactor = brief.revisions === -1 ? 1.15 : 1;

  const factors = [
    { id: 'complexity', label: `Complexity — ${complexity.label}`, value: complexity.factor, reason: complexity.detail },
    { id: 'urgency', label: `Urgency — ${urgency.label}`, value: urgency.factor, reason: urgency.detail },
    { id: 'clarity', label: `Scope — ${clarity.label}`, value: clarity.factor, reason: clarity.detail },
    { id: 'client', label: `Client — ${clientType.label}`, value: clientType.factor, reason: 'Budget, procurement and expectations scale with client size.' },
    { id: 'compression', label: 'Timeline pressure', value: compressionFactor, reason: `The schedule asks for ${Math.round(hoursPerWeek)} h per week.` },
    { id: 'revisions', label: 'Revision policy', value: revisionFactor, reason: brief.revisions === -1 ? 'Unlimited revisions carry an open-ended risk premium.' : 'Rounds are already priced into the hours.' }
  ].filter((f) => Math.abs(f.value - 1) > 0.001);

  const riskMultiplier = factors.reduce((acc, f) => acc * f.value, 1);
  const blendedRateUsd = marketRateUsd * riskMultiplier;

  /* --- Cost floor -------------------------------------------------- */
  let floorRateUsd = 0;
  if (brief.floor.enabled) {
    const annualNeed = (brief.floor.targetMonthlyIncome + brief.floor.monthlyCosts) * 12;
    const grossedUp = annualNeed / Math.max(0.3, 1 - brief.floor.taxReservePct / 100);
    const billableHours = brief.floor.billableHoursPerWeek * Math.max(1, 52 - brief.floor.weeksOffPerYear);
    floorRateUsd = billableHours > 0 ? grossedUp / billableHours / fx : 0;
  }
  const belowFloor = brief.floor.enabled && floorRateUsd > blendedRateUsd;
  const chargeRateUsd = Math.max(blendedRateUsd, floorRateUsd);

  /* --- Price ------------------------------------------------------- */
  const midUsd = chargeRateUsd * effectiveHours;

  // The range is a confidence statement: loose scope and less experience both
  // widen it, because both make the hour estimate less reliable.
  const spread = clamp(
    clarity.spread + (experience.factor < 0.9 ? 0.04 : 0) + (complexity.factor >= 1.32 ? 0.03 : 0),
    0.06,
    0.28
  );

  const lowUsd = midUsd * (1 - spread);
  const highUsd = midUsd * (1 + spread * 0.9);

  const price = {
    low: roundMoney(money(lowUsd)),
    mid: roundMoney(money(midUsd)),
    high: roundMoney(money(highUsd)),
    floorTotal: roundMoney(money(floorRateUsd * effectiveHours))
  };
  // Rounding must never invert the band.
  price.low = Math.min(price.low, price.mid);
  price.high = Math.max(price.high, price.mid);

  const confidence = spread <= 0.09 ? 'Tight' : spread <= 0.16 ? 'Moderate' : 'Wide';

  /* --- Hourly equivalents ------------------------------------------ */
  const hourly = {
    quoted: roundRate(price.mid / effectiveHours),
    optimistic: roundRate(price.mid / rawHours),
    day: roundMoney((price.mid / effectiveHours) * brief.hoursPerDay),
    marketRate: roundRate(money(marketRateUsd)),
    blendedRate: roundRate(money(blendedRateUsd)),
    floorRate: roundRate(money(floorRateUsd))
  };

  /* --- Waterfall: where the number comes from ----------------------- */
  const waterfall = [];
  let runningUsd = marketRateUsd * effectiveHours;
  waterfall.push({
    id: 'base',
    label: `${discipline.label} at ${experience.label.toLowerCase()}`,
    detail: `${currency.symbol}${Math.round(money(marketRateUsd))} per hour × ${Math.round(effectiveHours)} billable hours`,
    delta: roundMoney(money(runningUsd)),
    total: roundMoney(money(runningUsd)),
    kind: 'base'
  });

  for (const factor of factors) {
    const next = runningUsd * factor.value;
    const diff = money(next - runningUsd);
    waterfall.push({
      id: factor.id,
      label: factor.label,
      detail: factor.reason,
      delta: roundMoney(Math.abs(diff)) * (diff < 0 ? -1 : 1),
      percent: Math.round((factor.value - 1) * 100),
      total: roundMoney(money(next)),
      kind: next >= runningUsd ? 'up' : 'down'
    });
    runningUsd = next;
  }

  if (belowFloor) {
    waterfall.push({
      id: 'floor',
      label: 'Lifted to your cost floor',
      detail: 'Below this you are paying to work.',
      delta: roundMoney(money((floorRateUsd - blendedRateUsd) * effectiveHours)),
      total: price.mid,
      kind: 'floor'
    });
  }

  /* --- Payment schedule --------------------------------------------- */
  const suggestedDeposit = clamp(
    (brief.depositPct || clientType.deposit) + (urgency.factor >= 1.35 ? 10 : 0),
    0,
    100
  );
  const schedule = buildSchedule(price.mid, suggestedDeposit, effectiveHours, brief.durationWeeks);

  /* --- Extras -------------------------------------------------------- */
  const extras = {
    extraRevision: roundMoney(money(blendedRateUsd) * rawHours * 0.07),
    scopeCreepHourly: roundRate(money(blendedRateUsd) * 1.1),
    rushShare: roundMoney(money(marketRateUsd * effectiveHours * (urgency.factor - 1))),
    taxAmount: roundMoney(price.mid * (brief.taxPct / 100)),
    grandTotal: roundMoney(price.mid * (1 + brief.taxPct / 100))
  };

  const result = {
    brief,
    currency,
    labels: { discipline, experience, market, clientType, urgency, clarity, complexity },
    hours: {
      raw: Math.round(rawHours * 10) / 10,
      revision: Math.round(revisionHours * 10) / 10,
      admin: Math.round(adminHours * 10) / 10,
      effective: Math.round(effectiveHours * 10) / 10,
      perWeek: Math.round(hoursPerWeek * 10) / 10,
      rounds: revisionRounds
    },
    rates: hourly,
    price,
    band: { spread, confidence, belowFloor },
    factors,
    waterfall,
    schedule,
    extras
  };

  result.insights = buildInsights(result);
  result.summary = buildSummary(result);
  return result;
}

/* ------------------------------------------------------------------ *
 * Narrative layer
 * ------------------------------------------------------------------ */

function buildSchedule(total, depositPct, effectiveHours, weeks) {
  const deposit = Math.round(total * (depositPct / 100));
  if (effectiveHours > 60 || weeks > 6) {
    const milestone = Math.round((total - deposit) / 2);
    return [
      { label: 'Deposit', pct: depositPct, amount: deposit, when: 'On signature, before work starts' },
      { label: 'Midpoint', pct: Math.round((milestone / total) * 100), amount: milestone, when: 'At the agreed midpoint review' },
      { label: 'Final', pct: Math.round(((total - deposit - milestone) / total) * 100), amount: total - deposit - milestone, when: 'On delivery, before hand-off of final files' }
    ];
  }
  return [
    { label: 'Deposit', pct: depositPct, amount: deposit, when: 'On signature, before work starts' },
    { label: 'Final', pct: 100 - depositPct, amount: total - deposit, when: 'On delivery, before hand-off of final files' }
  ];
}

/** Plain-language checks a good mentor would run over the number. */
function buildInsights(r) {
  const out = [];
  const { brief, hours, rates, price, labels } = r;

  if (r.band.belowFloor) {
    out.push({
      tone: 'risk',
      title: 'This project was priced below your cost floor',
      body: `Your own numbers say you need ${r.currency.symbol}${rates.floorRate} an hour to cover costs, tax and income. The market rate for this brief came out lower, so the quote has been lifted to the floor. If the client pushes back, cut scope — not the rate.`
    });
  }

  if (brief.revisions === -1) {
    out.push({
      tone: 'risk',
      title: 'Unlimited revisions has no ceiling',
      body: `A 15% premium is included, but it does not make the risk go away. Offer ${labels.complexity.value >= 4 ? 'three' : 'two'} rounds and price further rounds at ${r.currency.symbol}${r.extras.extraRevision} each.`
    });
  } else if (brief.revisions >= 4) {
    out.push({
      tone: 'watch',
      title: `${brief.revisions} revision rounds is generous`,
      body: `Those rounds are ${hours.revision} of the ${hours.effective} hours you are quoting. Two or three is the usual professional standard.`
    });
  }

  if (hours.perWeek > 35) {
    out.push({
      tone: 'risk',
      title: 'The timeline does not fit the work',
      body: `Delivering ${hours.effective} hours in ${brief.durationWeeks} weeks means ${hours.perWeek} focused hours a week. Either extend the deadline or quote fewer deliverables — the surcharge alone will not create time.`
    });
  } else if (hours.perWeek > 25) {
    out.push({
      tone: 'watch',
      title: 'This will be close to a full-time load',
      body: `${hours.perWeek} hours a week leaves little room for another client. Make sure the schedule reflects that before you commit.`
    });
  }

  if (labels.clarity.spread >= 0.15) {
    out.push({
      tone: 'watch',
      title: 'Price the discovery separately',
      body: `With scope this loose, quote a paid discovery of ${Math.max(4, Math.round(hours.raw * 0.1))} hours first, then a fixed price once you both know what is being built. That is why the range below is ${r.band.confidence.toLowerCase()}.`
    });
  }

  if (labels.urgency.factor >= 1.35 && r.schedule[0].pct < 50) {
    out.push({
      tone: 'watch',
      title: 'Rush work needs money up front',
      body: 'You are rearranging your schedule for this client. Take at least 50% on signature, and say in writing that the deadline depends on the deposit clearing.'
    });
  }

  if (hours.effective > 80 && r.schedule.length < 3) {
    out.push({
      tone: 'watch',
      title: 'Break a project this size into milestones',
      body: 'Anything past two months of work should pay out in stages, so one late invoice never puts the whole project at risk.'
    });
  }

  if (labels.experience.factor <= 0.7 && price.mid > 0) {
    out.push({
      tone: 'good',
      title: 'Do not discount below this to "win" the job',
      body: `The starting-out factor is already applied — ${Math.round(labels.experience.factor * 100)}% of the established rate. Going lower teaches the client what your time is worth, and that is hard to undo.`
    });
  }

  if (labels.clientType.id === 'enterprise') {
    out.push({
      tone: 'good',
      title: 'Enterprise buyers expect a formal quote',
      body: 'Purchase orders, net-30 terms and a named contact are normal here. The quotation below includes the terms they will ask for.'
    });
  }

  if (rates.quoted < rates.optimistic * 0.8) {
    out.push({
      tone: 'watch',
      title: 'Your real hourly rate is lower than it looks',
      body: `On build hours alone this is ${r.currency.symbol}${rates.optimistic} an hour. Once revisions and admin are counted it is ${r.currency.symbol}${rates.quoted}. The second number is the one that pays your bills.`
    });
  }

  out.push({
    tone: 'good',
    title: 'How to say the number',
    body: `Quote ${r.currency.symbol}${r.price.mid.toLocaleString()} as one fixed fee, not a rate. If they push back, move scope \u2014 drop a deliverable and come down toward ${r.currency.symbol}${r.price.low.toLocaleString()}. ${r.schedule[0].pct}% on signature is what starts the clock.`
  });

  return out;
}

function buildSummary(r) {
  const { labels, hours, currency, price, brief } = r;
  const rounds = brief.revisions === -1
    ? 'unlimited revisions'
    : `${hours.rounds} revision round${hours.rounds === 1 ? '' : 's'}`;

  const drivers = r.factors
    .filter((f) => f.value > 1.02)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((f) => f.label.split(' \u2014 ')[0].toLowerCase());

  const driverText = drivers.length
    ? ` The number is driven up mainly by ${drivers.join(' and ')}.`
    : ' No single factor is pushing the price up \u2014 this is a clean, well-scoped brief.';

  return `${labels.discipline.label} for a ${labels.clientType.label.toLowerCase()}, priced for the ${labels.market.label} market, at ${Math.round(hours.effective)} billable hours once ${rounds} and admin are counted. A fair fee is ${currency.symbol}${price.low.toLocaleString()}\u2013${currency.symbol}${price.high.toLocaleString()}, with ${currency.symbol}${price.mid.toLocaleString()} as the number to put on the quote.${driverText}`;
}

/** Match the description against the scope-signal table. */
export function detectSignals(description) {
  if (typeof description !== 'string' || description.length < 8) return [];
  return SIGNALS.filter((signal) => signal.test.test(description));
}

/** A complexity level suggested by how many scope signals fired. */
export function suggestedComplexity(signals) {
  const weighted = signals.reduce((sum, s) => sum + s.weight, 0);
  if (weighted >= 5) return 5;
  if (weighted >= 3) return 4;
  if (weighted >= 2) return 3;
  if (weighted >= 1) return 2;
  return 1;
}
