const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// escape text so user input can never break the page
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const hhmm = d => new Date(d).toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit', hour12:false });

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

function startClock() {
  const tick = () => { const c = $('#clock'); if (c) c.textContent = new Date().toLocaleTimeString('en-PH', { hour12:false }) + ' PHT'; };
  tick(); setInterval(tick, 1000);
}

function bindNetwork() {
  const f = () => { const n = $('#net'); n.textContent = navigator.onLine ? '● ONLINE · Secure channel' : '● OFFLINE · saving locally'; n.className = 'net ' + (navigator.onLine ? 'ok' : 'off'); };
  addEventListener('online', f); addEventListener('offline', f); f();
}

// button-style option picker; returns a getter for the selected value
function chips(id, def) {
  const box = $('#' + id); let val = def;
  box.innerHTML = box.dataset.opts.split(',').map(o => `<button type="button" class="chip ${o === def ? 'on' : ''}">${o}</button>`).join('');
  box.onclick = e => { if (e.target.matches('.chip')) { $$('.chip', box).forEach(c => c.classList.remove('on')); e.target.classList.add('on'); val = e.target.textContent; } };
  return () => val;
}

// pop-up dialog (Electron does not support window.prompt, so we use our own)
function modal(title, body, onOk, okText = 'Save') {
  const m = $('#modal');
  m.innerHTML = `<div class="dialog"><div class="card-h"><b>${title}</b><button class="btn ghost small" id="mClose">✕</button></div>${body}<div class="row end"><button class="btn" id="mCancel">Cancel</button><button class="btn primary" id="mOk">${okText}</button></div></div>`;
  m.classList.add('open');
  const close = () => { m.classList.remove('open'); m.innerHTML = ''; };
  $('#mClose').onclick = $('#mCancel').onclick = close;
  $('#mOk').onclick = () => { if (onOk() !== false) close(); };
}