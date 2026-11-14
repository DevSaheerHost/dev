/* =========================================================================
   S-CORE TECH — behaviour
   Markup in index.html, styles in styles.css.
   ========================================================================= */

/* -------------------------------------------------------------------------
   THE WHATSAPP NUMBER every booking button opens.
   International format, digits only, no "+" and no spaces.
------------------------------------------------------------------------- */
const WHATSAPP = '917592949476';

/* -------------------------------------------------------------------------
   PROOF — the only part of this site a stranger has no reason to doubt.

   Everything else on the page is a claim. These are the receipts. While both
   lists are empty the whole Proof section stays off the page, because an
   empty testimonial block is worse than none at all.

   Photos go in s-core-tech/proof/ — before and after are optional; a job with
   only a title and a note still earns its place. Full notes in proof/README.md.
------------------------------------------------------------------------- */
const PROOF_JOBS = [
  // {
  //   title: 'MacBook Pro 2017 — dead, no charge light',
  //   note:  'Liquid damage across the board. Cleaned, two power rails rebuilt, '
  //        + 'back with the owner the next evening.',
  //   before: 'proof/macbook-before.jpg',   // optional
  //   after:  'proof/macbook-after.jpg',    // optional
  //   price:  '₹3,200',                     // optional
  // },
];

const PROOF_WORDS = [
  // { text: 'Took it to two shops before this. Fixed in a day and the price did not move.',
  //   who: 'Rashid', where: 'Manjeri' },
];

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const rupee = n => '₹' + n.toLocaleString('en-IN');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------- TRACKING -- */
/* The three numbers worth knowing: which core people choose, how many open
   the booking drawer, and how many actually reach WhatsApp. The gap between
   the last two is the one that tells you something.

   This only pushes onto dataLayer, which is a plain array. If the tag manager
   loads, it forwards them; if it is blocked, or you swap it for something
   else later, nothing here breaks and nothing is lost but the reporting.
   No names, numbers or message text are ever sent — only what was picked. */
function track(event, data) {
  try {
    (window.dataLayer = window.dataLayer || []).push({ event, ...data });
  } catch (e) { /* analytics must never take the page down */ }
}

/* ---------------------------------------------------------------- CORE -- */
/* One attribute drives the whole page; everything else is CSS reacting. */
let core = 'hardware';

function setCore(next, origin) {
  if (next === core) return;
  core = next;

  // The sweep is anchored on whatever was clicked, so the pulse appears to
  // come out of the switch rather than from an arbitrary corner.
  const sweep = $('#sweep');
  if (origin && !reduced) {
    const r = origin.getBoundingClientRect();
    sweep.style.setProperty('--ox', (r.left + r.width / 2) + 'px');
    sweep.style.setProperty('--oy', (r.top + r.height / 2) + 'px');
    sweep.classList.remove('go');
    void sweep.offsetWidth;          // restart the animation
    sweep.classList.add('go');
  }

  document.documentElement.dataset.core = next;
  document.querySelector('meta[name="theme-color"]')
    .setAttribute('content', next === 'hardware' ? '#0a0a0c' : '#05050a');

  $$('[data-core-btn]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.coreBtn === next)));

  try { localStorage.setItem('score.core', next); } catch (e) {}
  track('core_switch', { core: next });

  stagger();                          // bring the new content in
  buildBooking(next === 'hardware' ? 'repair' : 'website');
}

/* The incoming panels animate in one after another rather than all at once. */
function stagger() {
  $$('.rv').forEach(el => el.classList.remove('in'));
  requestAnimationFrame(() => {
    $$('[data-panel="' + core + '"] .rv').forEach((el, i) => {
      el.style.transitionDelay = (reduced ? 0 : Math.min(i * 55, 450)) + 'ms';
      el.classList.add('in');
    });
    // Anything outside the panels (the combo band) just comes back.
    $$('section .rv').forEach(el => {
      if (!el.closest('[data-panel]')) el.classList.add('in');
    });
  });
}

$$('[data-core-btn]').forEach(b =>
  b.addEventListener('click', () => setCore(b.dataset.coreBtn, b)));

/* ------------------------------------------------------------- SERVICES - */
const CATALOG = {
  repair: [
    { id:'laptop',   name:'Laptop Turbo Upgrade',     sub:'SSD, RAM, paste, deep clean', from:499,  to:2499 },
    { id:'phone',    name:'Smartphone Surgery',       sub:'Display, battery, port',      from:299,  to:3999 },
    { id:'recovery', name:'OS & Dead-Device Recovery',sub:'Quoted after a free check',   from:0,    to:0    },
    { id:'board',    name:'Chip-level board repair',  sub:'Water damage, no-power',      from:899,  to:4999 },
    { id:'pickup',   name:'Doorstep pickup & drop',   sub:'Free with any repair',        from:0,    to:0    }
  ],
  website: [
    { id:'landing',   name:'Business Landing Page',   sub:'WhatsApp booking, SEO ready', from:2999, to:2999 },
    { id:'qr',        name:'QR Menu & Catalog',       sub:'Cafes, restaurants, shops',   from:1999, to:1999 },
    { id:'launchpad', name:'B2B Digital Launchpad',   sub:'Web app + Google + speed',    from:4499, to:4499 },
    { id:'seo',       name:'Google Business Profile', sub:'Set up and verified',         from:799,  to:799  },
    { id:'care',      name:'Edits & care, 3 months',  sub:'Changes whenever you need',   from:999,  to:999  }
  ]
};
const LABEL = { repair:'Device repair', website:'Website', combo:'Dual-Core combo' };

/* --------------------------------------------------------- ESTIMATOR ---- */
const estPicked = new Set(['laptop']);

function optionRow(item, picked, onToggle) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'opt';
  b.setAttribute('role', 'checkbox');
  b.setAttribute('aria-checked', String(picked));
  b.innerHTML =
    '<span class="box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></span>' +
    '<span class="t"><b></b><span></span></span>' +
    '<span class="p mono"></span>';
  b.querySelector('.t b').textContent = item.name;
  b.querySelector('.t span').textContent = item.sub;
  b.querySelector('.p').textContent =
    item.from === 0 ? 'Free check' :
    item.from === item.to ? rupee(item.from) : rupee(item.from) + '+';
  b.addEventListener('click', () => onToggle(item.id, b));
  return b;
}

function renderEstimator() {
  const host = $('#estOpts');
  if (!host) return;
  host.innerHTML = '';
  CATALOG.repair.forEach(item => {
    host.appendChild(optionRow(item, estPicked.has(item.id), (id, el) => {
      estPicked.has(id) ? estPicked.delete(id) : estPicked.add(id);
      el.setAttribute('aria-checked', String(estPicked.has(id)));
      totalEstimator();
    }));
  });
  totalEstimator();
}

function totalEstimator() {
  let lo = 0, hi = 0, quoted = false;
  CATALOG.repair.forEach(i => {
    if (!estPicked.has(i.id)) return;
    if (i.from === 0) { quoted = true; return; }
    lo += i.from; hi += i.to;
  });
  const out = $('#estTotal');
  if (!out) return;
  if (!lo && quoted) out.textContent = 'After free check';
  else if (!lo) out.textContent = '₹0';
  else out.textContent = rupee(lo) + ' – ' + rupee(hi) + (quoted ? ' +' : '');
}

/* ----------------------------------------------------------- BOOKING ---- */
let bookMode = 'repair';
const bookPicked = new Set();

function buildBooking(mode, preselect) {
  bookMode = mode === 'website' ? 'website' : 'repair';
  bookPicked.clear();
  if (preselect) bookPicked.add(preselect);

  $$('#bookMode button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.bmode === bookMode)));

  const host = $('#bookOpts');
  host.innerHTML = '';
  CATALOG[bookMode].forEach(item => {
    host.appendChild(optionRow(item, bookPicked.has(item.id), (id, el) => {
      bookPicked.has(id) ? bookPicked.delete(id) : bookPicked.add(id);
      el.setAttribute('aria-checked', String(bookPicked.has(id)));
      totalBooking();
    }));
  });
  totalBooking();
}

function totalBooking() {
  let lo = 0, hi = 0, quoted = false;
  CATALOG[bookMode].forEach(i => {
    if (!bookPicked.has(i.id)) return;
    if (i.from === 0) { quoted = true; return; }
    lo += i.from; hi += i.to;
  });
  const out = $('#bookTotal');
  if (!lo && quoted) out.textContent = 'After free check';
  else if (!lo) out.textContent = 'Nothing picked yet';
  /* The trailing + matters: it says a quoted item is in the basket and the real
     figure is above this range. The estimator shows it, so the drawer must too,
     or the same three ticks read as two different prices. */
  else out.textContent = (lo === hi ? rupee(lo) : rupee(lo) + ' – ' + rupee(hi)) + (quoted ? ' +' : '');
}

$$('#bookMode button').forEach(b =>
  b.addEventListener('click', () => buildBooking(b.dataset.bmode)));

/* ------------------------------------------------------------- DRAWER --- */
const drawer = $('#drawer'), scrim = $('#scrim');
let lastFocus = null;

function openDrawer(mode, preselect) {
  lastFocus = document.activeElement;

  if (mode === 'combo') {
    buildBooking('website');
    $('#bNote').value = 'I am interested in the Dual-Core combo — shop PCs serviced plus a website.';
  } else {
    buildBooking(mode || (core === 'hardware' ? 'repair' : 'website'), preselect);
  }

  track('book_open', { core, mode: bookMode, picked: bookPicked.size });
  drawer.classList.add('on');
  scrim.classList.add('on');
  drawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#drawerClose').focus(), 60);
}

function closeDrawer() {
  drawer.classList.remove('on');
  scrim.classList.remove('on');
  drawer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (lastFocus) lastFocus.focus();
}

$$('[data-book]').forEach(b => b.addEventListener('click', () => {
  const m = b.dataset.book;
  // The estimator's own button carries whatever is ticked into the drawer.
  if (b.id === 'estBook') {
    buildBooking('repair');
    estPicked.forEach(id => bookPicked.add(id));
    $$('#bookOpts .opt').forEach((el, i) => {
      const item = CATALOG.repair[i];
      el.setAttribute('aria-checked', String(bookPicked.has(item.id)));
    });
    totalBooking();
    openDrawerNoRebuild();
    return;
  }
  openDrawer(m || undefined, b.dataset.pick);
}));

function openDrawerNoRebuild() {
  lastFocus = document.activeElement;
  track('book_open', { core, mode: bookMode, picked: bookPicked.size, from: 'estimator' });
  drawer.classList.add('on');
  scrim.classList.add('on');
  drawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#drawerClose').focus(), 60);
}

$('#drawerClose').addEventListener('click', closeDrawer);
scrim.addEventListener('click', closeDrawer);
addEventListener('keydown', e => {
  if (e.key === 'Escape' && drawer.classList.contains('on')) closeDrawer();
  // Keep the tab ring inside the drawer while it is open.
  if (e.key === 'Tab' && drawer.classList.contains('on')) {
    const f = $$('button, input, textarea, select, a[href]', drawer)
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

/* ------------------------------------------------------- WHATSAPP OUT --- */
$('#sendWa').addEventListener('click', () => {
  const name  = $('#bName').value.trim();
  const place = $('#bPlace').value.trim();
  const note  = $('#bNote').value.trim();
  const items = CATALOG[bookMode].filter(i => bookPicked.has(i.id));

  const lines = [];
  lines.push('*S-Core Tech — new enquiry*');
  lines.push('');
  lines.push('Type: ' + LABEL[bookMode]);
  if (items.length) {
    lines.push('Services:');
    items.forEach(i => lines.push('  • ' + i.name +
      (i.from ? ' (' + (i.from === i.to ? rupee(i.from) : 'from ' + rupee(i.from)) + ')' : ' (free check)')));
  }
  lines.push('Indicative total: ' + $('#bookTotal').textContent);
  if (name)  lines.push('Name: ' + name);
  if (place) lines.push('Area: ' + place);
  if (note)  lines.push('Notes: ' + note);
  lines.push('');
  lines.push('Sent from s-core-tech');

  track('wa_send', {
    core,
    mode: bookMode,
    picked: items.length,
    named: Boolean(name),          // whether they filled it in, never what they typed
    area: Boolean(place),
    noted: Boolean(note),
  });

  location.href = 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(lines.join('\n'));
});

/* ------------------------------------------------- MICRO-INTERACTIONS --- */
/* Cards light up where the pointer is. Pointer only: a finger has no hover,
   and running this on touchmove would just cost battery. */
if (matchMedia('(hover: hover)').matches) {
  addEventListener('pointermove', e => {
    const card = e.target.closest ? e.target.closest('.card, .combo') : null;
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    card.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  /* Magnetic buttons: a few pixels of pull, no more. Enough to feel alive,
     little enough that nobody misses the target. */
  if (!reduced) $$('.magnetic').forEach(b => {
    b.addEventListener('pointermove', e => {
      const r = b.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      b.style.transform = 'translate(' + (dx * 7).toFixed(1) + 'px,' + (dy * 5).toFixed(1) + 'px)';
    });
    b.addEventListener('pointerleave', () => { b.style.transform = ''; });
  });
}

/* Reveal on scroll. */
const io = new IntersectionObserver(es => {
  es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
}, { rootMargin: '0px 0px -8% 0px', threshold: .05 });
$$('.rv').forEach(el => io.observe(el));

/* The PCB nodes, scattered once and left to pulse. */
(() => {
  const host = $('#nodes');
  const pts = [[8,22],[19,58],[31,14],[44,74],[58,30],[69,63],[82,18],[91,48],[14,86],[76,88]];
  pts.forEach(([x, y], i) => {
    const n = document.createElement('span');
    n.className = 'node';
    n.style.left = x + 'vw';
    n.style.top = y + 'vh';
    n.style.animationDelay = (i * .34) + 's';
    host.appendChild(n);
  });
})();

/* The diagnostic meters fill once they are on screen. */
(() => {
  const fill = () => $$('[data-meter]').forEach(m => { m.style.width = m.dataset.meter + '%'; });
  setTimeout(fill, 300);
  // Numbers drift a little, the way a live readout does.
  if (!reduced) setInterval(() => {
    const t = $('[data-diag="thermal"]');
    const b = $('[data-diag="batt"]');
    if (t) t.textContent = (74 + Math.floor(Math.random() * 7)) + '°C';
    if (b) b.textContent = (83 + Math.floor(Math.random() * 3)) + '%';
  }, 2600);
})();

/* The code window types itself out, once. */
(() => {
  const el = $('#typer');
  if (!el) return;
  const src =
`<span class="c">// one page, built to convert</span>
<span class="k">export default function</span> <span class="t">Landing</span>() {
  <span class="k">return</span> (
    &lt;<span class="t">Hero</span>
      title=<span class="s">"Kerala Spice Cafe"</span>
      cta=<span class="s">"Order on WhatsApp"</span>
      speed=<span class="s">"1.2s"</span>
    /&gt;
  )
}`;
  if (reduced) { el.innerHTML = src; return; }
  let i = 0;
  const tick = () => {
    // Step over whole tags so markup is never half-written to the DOM.
    if (src[i] === '<' && src.slice(i, i + 6) !== '&lt;') {
      i = src.indexOf('>', i) + 1;
    } else {
      i += 1;
    }
    el.innerHTML = src.slice(0, i);
    if (i < src.length) setTimeout(tick, 18);
  };
  tick();
})();

/* ------------------------------------------------------------- BOOT ----- */
$('#yr').textContent = new Date().getFullYear();
renderEstimator();
buildBooking('repair');

try {
  const saved = localStorage.getItem('score.core');
  if (saved === 'software') setCore('software');
} catch (e) {}

/* ---------------------------------------------------------------- PROOF -- */
/* Built from the two lists at the top of this file. Nothing is invented here:
   if you have put nothing in, nothing appears. Text goes in through
   textContent, never innerHTML, so a stray < in a customer's words is a
   character and not markup. */
function renderProof() {
  const section = $('#proof');
  if (!section) return;
  if (!PROOF_JOBS.length && !PROOF_WORDS.length) return;   // stays hidden

  const jobs = $('#proofJobs');
  PROOF_JOBS.forEach(job => {
    const card = document.createElement('article');
    card.className = 'card job rv';

    if (job.before || job.after) {
      const pair = document.createElement('div');
      pair.className = 'job-pair';
      [['before', job.before], ['after', job.after]].forEach(([label, src]) => {
        if (!src) return;
        const fig = document.createElement('figure');
        const img = document.createElement('img');
        img.src = src;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = label + ': ' + job.title;
        const cap = document.createElement('figcaption');
        cap.textContent = label;
        fig.append(img, cap);
        pair.appendChild(fig);
      });
      card.appendChild(pair);
    }

    const h = document.createElement('h4');
    h.textContent = job.title;
    card.appendChild(h);

    if (job.note) {
      const p = document.createElement('p');
      p.textContent = job.note;
      card.appendChild(p);
    }
    if (job.price) {
      const b = document.createElement('b');
      b.className = 'job-price';
      b.textContent = job.price;
      card.appendChild(b);
    }
    jobs.appendChild(card);
  });

  const words = $('#proofWords');
  PROOF_WORDS.forEach(w => {
    const fig = document.createElement('figure');
    fig.className = 'card word rv';
    const q = document.createElement('blockquote');
    q.textContent = w.text;
    const cite = document.createElement('figcaption');
    cite.textContent = [w.who, w.where].filter(Boolean).join(' · ');
    fig.append(q, cite);
    words.appendChild(fig);
  });

  section.hidden = false;
  // The reveal observer was wired before these existed, so it has never seen
  // them. Without this they stay at opacity 0 and the section looks empty.
  $$('#proof .rv').forEach(el => io.observe(el));
}

renderProof();
stagger();
