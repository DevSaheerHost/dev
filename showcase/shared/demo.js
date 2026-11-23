/* =========================================================================
   SHOWCASE DEMOS — shared behaviour.

   These are sample sites for fictional businesses, so their "Book" and
   "Order" buttons must not message anyone real. A link or button marked
   [data-demo], and any submitted .demo-form, shows a short note instead,
   explaining what it does on a real client's site. Forms keep their note
   in [data-demo-note] so clicks on their own fields are never intercepted.
   ========================================================================= */
'use strict';

(() => {
  const DEFAULT_NOTE = 'Demo button — on your real site this opens WhatsApp with the details already filled in.';
  let toast = null;
  let timer = 0;

  function show(text) {
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'sl-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.append(toast);
    }
    toast.textContent = text;          // never innerHTML
    // Restart the transition so repeated clicks still read as feedback.
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-demo]');
    if (!el) return;
    e.preventDefault();
    show(el.dataset.demo || DEFAULT_NOTE);
  });

  document.addEventListener('submit', e => {
    if (!e.target.closest('.demo-form')) return;
    e.preventDefault();
    show(e.target.dataset.demoNote || DEFAULT_NOTE);
  });

  // Simple option pickers inside demos: one active chip per [data-pick] group.
  document.addEventListener('click', e => {
    const chip = e.target.closest('[data-pick] > button');
    if (!chip) return;
    chip.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === chip)));
  });

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
