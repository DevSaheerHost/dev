/* =========================================================================
   START A PROJECT — website enquiry form.

   No backend: the brief is assembled here and handed to WhatsApp as a
   wa.me link the visitor opens and sends themselves. Nothing is stored,
   nothing is posted, and user text is only ever written with textContent.
   ========================================================================= */
'use strict';

/* International format, digits only — same number as S-Core Tech. */
const WHATSAPP = '917592949476';

/* ------------------------------------------------------------- OPTIONS -- */
const OPTIONS = {
  type: [
    { id: 'landing',  label: 'Landing page',        hint: 'One page for your business',       from: 2999 },
    { id: 'business', label: 'Business website',    hint: 'Home, about, services, contact',   from: 4499 },
    { id: 'store',    label: 'Online store',        hint: 'Products, cart, orders',           from: 7999 },
    { id: 'menu',     label: 'QR menu / catalog',   hint: 'Cafés, restaurants, shops',        from: 1999 },
    { id: 'webapp',   label: 'Web app / dashboard', hint: 'Logins, data, custom tools',       from: 9999 },
    { id: 'redesign', label: 'Redesign / fix',      hint: 'Improve a site you already have',  from: 0 },
  ],
  features: [
    'WhatsApp booking', 'Contact form', 'Photo gallery', 'Google Maps',
    'Online payments', 'Admin panel', 'Blog / news', 'Multi-language',
    'SEO & Google listing', 'Ongoing updates',
  ],
  pages:    ['1 page', '2–5 pages', '6–10 pages', '10+ / not sure'],
  domain:   ['I have one', 'Need one', 'Not sure'],
  budget:   ['Under ₹3,000', '₹3,000 – ₹7,000', '₹7,000 – ₹15,000', '₹15,000+', 'Not sure yet'],
  timeline: ['ASAP', 'Within 2 weeks', 'Within a month', 'Flexible'],
};

/* Showcase samples that can link here as ?sample=<id>. Only these ids are
   accepted; anything else in the URL is ignored. */
const SAMPLES = {
  salon:    'Salon sample (Mehndi & Mirror)',
  gym:      'Gym sample (Ironcore Fitness)',
  homestay: 'Homestay sample (Palm Breeze)',
  tuition:  'Tuition sample (BrightPath Academy)',
  cafe:     'Café sample (Kerala Spice)',
  clinic:   'Clinic sample (Pulse Clinic)',
  store:    'Shop sample (Moonlight Mobiles)',
};

const LIMITS = { name: 60, phone: 16, email: 80, business: 60, ref: 200, brief: 1000 };

/* ------------------------------------------------------------- HELPERS -- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const rupee = n => '₹' + n.toLocaleString('en-IN');

const SVG_NS = 'http://www.w3.org/2000/svg';
function tickIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'tick');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'polyline');
  p.setAttribute('points', '20 6 9 17 4 12');
  svg.append(p);
  return svg;
}

/* Strip control characters (keeping newlines only where allowed), collapse
   runs of blank lines and clamp length. Applied to every value before it
   goes anywhere — the summary or the WhatsApp message. */
function clean(value, max, multiline = false) {
  let v = String(value ?? '').normalize('NFC');
  v = multiline
    ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
       .replace(/\n{3,}/g, '\n\n')
    : v.replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s{2,}/g, ' ');
  return v.trim().slice(0, max);
}

const isEmail = v => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(v);
const phoneDigits = v => v.replace(/[\s\-().]/g, '');
const isPhone = v => /^\+?\d{7,15}$/.test(phoneDigits(v));

function isHttpUrl(v) {
  try {
    const u = new URL(v);
    return (u.protocol === 'https:' || u.protocol === 'http:') && Boolean(u.hostname.includes('.'));
  } catch { return false; }
}

/* ----------------------------------------------------- CHOICE CHIPS ----- */
/* Single-select groups behave as radio groups, multi-select as toggle
   buttons. State lives in this map, not in the DOM. */
const picked = new Map(Object.keys(OPTIONS).map(k => [k, new Set()]));

function buildChip(group, opt, single) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip';
  const value = typeof opt === 'string' ? opt : opt.id;
  btn.dataset.value = value;

  if (single) {
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
  } else {
    btn.setAttribute('aria-pressed', 'false');
    btn.append(tickIcon());
  }

  if (typeof opt === 'string') {
    btn.append(document.createTextNode(opt));
  } else {
    const strong = document.createElement('strong');
    strong.textContent = opt.label;
    const hint = document.createElement('small');
    hint.textContent = opt.hint;
    const from = document.createElement('small');
    from.className = 'from';
    from.textContent = opt.from ? 'from ' + rupee(opt.from) : 'quoted after a look';
    btn.append(strong, hint, from);
  }
  return btn;
}

function setChoice(container, group, value, single) {
  const set = picked.get(group);
  if (single) {
    set.clear();
    set.add(value);
    $$('.chip', container).forEach(c => {
      const on = c.dataset.value === value;
      c.setAttribute('aria-checked', String(on));
      c.tabIndex = on ? 0 : -1;
    });
  } else {
    const chip = $$('.chip', container).find(c => c.dataset.value === value);
    const on = !set.has(value);
    on ? set.add(value) : set.delete(value);
    chip.setAttribute('aria-pressed', String(on));
  }
  clearError(group);
}

function initChoices() {
  $$('[data-group]').forEach(container => {
    const group = container.dataset.group;
    const single = container.hasAttribute('data-single');
    const frag = document.createDocumentFragment();
    OPTIONS[group].forEach(opt => frag.append(buildChip(group, opt, single)));
    container.append(frag);

    if (single) {
      // Roving tabindex: one tab stop per group, arrows move within it.
      $$('.chip', container).forEach((c, i) => { c.tabIndex = i === 0 ? 0 : -1; });
    }

    container.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (chip) setChoice(container, group, chip.dataset.value, single);
    });

    if (single) {
      container.addEventListener('keydown', e => {
        const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        if (!(e.key in keys)) return;
        e.preventDefault();
        const chips = $$('.chip', container);
        const i = chips.indexOf(document.activeElement);
        const next = chips[(i + keys[e.key] + chips.length) % chips.length];
        next.focus();
        setChoice(container, group, next.dataset.value, true);
      });
    }
  });
}

/* --------------------------------------------------------- VALIDATION --- */
function fieldWrap(key) {
  const el = document.getElementById(key);
  return el ? el.closest('.field') : $(`[data-group="${key}"]`).closest('.field');
}

function showError(key, msg) {
  const err = $(`.err[data-for="${key}"]`);
  if (err) err.textContent = msg;
  fieldWrap(key).classList.add('invalid');
  const input = document.getElementById(key);
  if (input) input.setAttribute('aria-invalid', 'true');
}

function clearError(key) {
  const err = $(`.err[data-for="${key}"]`);
  if (err) err.textContent = '';
  const wrap = fieldWrap(key);
  if (wrap) wrap.classList.remove('invalid');
  const input = document.getElementById(key);
  if (input) input.removeAttribute('aria-invalid');
}

function readForm() {
  const val = id => document.getElementById(id).value;
  const typeId = [...picked.get('type')][0];
  const one = g => [...picked.get(g)][0] || '';
  return {
    name:     clean(val('name'), LIMITS.name),
    phone:    clean(val('phone'), LIMITS.phone),
    email:    clean(val('email'), LIMITS.email),
    business: clean(val('business'), LIMITS.business),
    ref:      clean(val('ref'), LIMITS.ref),
    brief:    clean(val('brief'), LIMITS.brief, true),
    type:     OPTIONS.type.find(t => t.id === typeId) || null,
    features: OPTIONS.features.filter(f => picked.get('features').has(f)),
    pages:    one('pages'),
    domain:   one('domain'),
    budget:   one('budget'),
    timeline: one('timeline'),
    trap:     val('website'),
    sample:   inspiredBy,
  };
}

function validate(d) {
  const errors = [];
  if (d.name.length < 2)                 errors.push(['name', 'Please tell me your name.']);
  if (!isPhone(d.phone))                 errors.push(['phone', 'Enter a valid phone number, e.g. +91 98765 43210.']);
  if (d.email && !isEmail(d.email))      errors.push(['email', 'That email doesn’t look right.']);
  if (!d.type)                           errors.push(['type', 'Pick the kind of website you need.']);
  if (d.ref && !isHttpUrl(d.ref))        errors.push(['ref', 'Use a full link starting with https://']);
  if (!d.budget)                         errors.push(['budget', 'Pick a budget range — “Not sure yet” is fine.']);
  if (d.brief.length < 15)               errors.push(['brief', 'A sentence or two about the project, please.']);

  ['name', 'phone', 'email', 'type', 'ref', 'budget', 'brief'].forEach(clearError);
  errors.forEach(([k, m]) => showError(k, m));

  if (errors.length) {
    const first = fieldWrap(errors[0][0]);
    first.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    const focusable = document.getElementById(errors[0][0]) || $('.chip', first);
    focusable.focus({ preventScroll: true });
  }
  return errors.length === 0;
}

/* ----------------------------------------------------------- SUMMARY ---- */
function rows(d) {
  return [
    ['Name', d.name],
    ['Phone', d.phone],
    ['Email', d.email],
    ['Business', d.business],
    ['Project', d.type ? d.type.label : ''],
    ['Inspired by', d.sample],
    ['Features', d.features.join(', ')],
    ['Pages', d.pages],
    ['Domain', d.domain],
    ['Budget', d.budget],
    ['Timeline', d.timeline],
    ['Reference', d.ref],
    ['Brief', d.brief],
  ].filter(([, v]) => v);
}

function renderSummary(d) {
  const dl = $('#summary');
  dl.replaceChildren(...rows(d).map(([k, v]) => {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = v;
    div.append(dt, dd);
    return div;
  }));
}

function message(d) {
  const lines = ['*New website enquiry — Saheer\'s Lab*', ''];
  rows(d).forEach(([k, v]) => {
    lines.push(k === 'Brief' ? `\n*${k}:*\n${v}` : `*${k}:* ${v}`);
  });
  return lines.join('\n');
}

/* ------------------------------------------------------------ WIRING ---- */
let current = null;
const form = $('#enquiry');
const dialog = $('#review');
const briefEl = $('#brief');
const countEl = $('#briefCount');

form.addEventListener('submit', e => {
  e.preventDefault();
  const data = readForm();
  if (!validate(data)) return;
  current = data;
  renderSummary(data);
  $('#sendWa').href = 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(message(data));
  $('#copyStatus').textContent = '';
  dialog.showModal();
});

// Clear a text field's error as soon as the visitor starts fixing it.
['name', 'phone', 'email', 'ref', 'brief'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => clearError(id));
});

briefEl.addEventListener('input', () => {
  countEl.textContent = `${briefEl.value.length} / ${LIMITS.brief}`;
});

$('#closeReview').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

$('#sendWa').addEventListener('click', e => {
  // Honeypot filled → a bot. Close quietly and send nothing.
  if (!current || current.trap) { e.preventDefault(); dialog.close(); }
});

$('#copyBrief').addEventListener('click', async () => {
  if (!current) return;
  const status = $('#copyStatus');
  try {
    await navigator.clipboard.writeText(message(current).replace(/\*/g, ''));
    status.textContent = 'Copied — paste it into WhatsApp, email or SMS.';
  } catch {
    status.textContent = 'Couldn’t copy automatically. Please select the text above.';
  }
});

/* ----------------------------------------------------------- PREFILL ---- */
/* Links from the showcase arrive as ?type=<id>&sample=<id>. Both values are
   looked up in fixed lists, so the URL can choose an option but can never
   inject text into the page or the message. */
let inspiredBy = '';

function prefillFromUrl() {
  const params = new URLSearchParams(location.search);
  const typeId = params.get('type');
  const sampleId = params.get('sample');

  if (typeId && OPTIONS.type.some(t => t.id === typeId)) {
    setChoice($('[data-group="type"]'), 'type', typeId, true);
  }
  if (sampleId && Object.hasOwn(SAMPLES, sampleId)) {
    inspiredBy = SAMPLES[sampleId];
    const note = $('#sampleNote');
    $('#sampleName').textContent = inspiredBy;
    note.hidden = false;
  }
}

$('#year').textContent = new Date().getFullYear();
initChoices();
prefillFromUrl();
