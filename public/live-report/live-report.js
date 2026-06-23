/* ===========================================================================
   PTY FUTURE SHOWS — renderer + paginator (vanilla)
   Forked from /report/report.js (the Match Report exporter). Same standalone-HTML
   + measured-pagination skeleton; the stat-column row is replaced by an artist/event
   CARD with a show list. Reuses /report/styles.css chrome (sheet, masthead, runhead,
   runfoot, career chips); /live-report/live.css styles the card body.
   window.LIVE_DATA = { meta, groups:[ {countryLabel, cities:[ {label, cards:[
   {key,name,image,isEvent,career, shows:[{date,city,state,venue}]} ]} ]} ] }
   By-city: groups = countries → cities → cards. By-artist: one header-less wrapper
   (countryLabel:null, one city label:null) holding all cards.
   ======================================================================== */
(function () {
  const DATA = window.LIVE_DATA;
  const doc = () => document.getElementById('doc');

  const MAST_LOGO_H = 48;
  const RUNHEAD_LOGO_H = 28;

  /* ---------- helpers ---------- */
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const STAGE_CSS = {
    legendary: 'legendary', superstar: 'superstar', mainstream: 'mainstream',
    midlevel: 'midlevel', developing: 'developing', undiscovered: 'undiscovered'
  };
  function careerCls(stage) {
    return 'st-' + (STAGE_CSS[keyOf(stage)] || 'mainstream');
  }

  /* ---------- chrome (reused look from report.js) ---------- */
  function runhead() {
    const h = el('div', 'runhead');
    h.innerHTML =
      `<div class="rh-left"><img src="/report/img/PTY_Logo_Type_Yellow.svg" alt="Please & Thank You" style="height:${RUNHEAD_LOGO_H}px;width:auto;display:block"></div>
       <div class="rh-right"><div class="rh-label">Future Shows</div></div>`;
    return h;
  }
  function runfoot() {
    const f = el('div', 'runfoot');
    f.innerHTML = `<span>Please &amp; Thank You — Confidential</span><span class="pg">—</span>`;
    return f;
  }

  /* ---------- masthead (page 1) ---------- */
  function masthead() {
    const m = DATA.meta;
    const wrap = el('div', 'masthead');
    const params = [
      ['Client / Event', m.client],
      ['Date Range', m.dateRange],
      ['Scope', m.scope],
      ['Grouped By', m.group === 'artist' ? 'Artist' : 'City'],
      ['Generated', m.generated],
      ['Shows', String(m.showCount)]
    ].map((p) => `<div class="param"><div class="k">${esc(p[0])}</div><div class="v">${esc(p[1])}</div></div>`).join('');

    wrap.innerHTML =
      `<div class="mast-top">
         <div class="lock"><img src="/report/img/PTY_Logo_Type_URL_Yellow.svg" alt="Please & Thank You" style="height:${MAST_LOGO_H}px;width:auto;display:block"></div>
       </div>
       <div class="mast-title">${esc(m.reportTitle)}</div>
       <div class="mast-sub">Live Show Schedule</div>
       <div class="mast-rule"></div>
       <div class="params">
         ${params}
         <div class="param count"><div class="k">Artists / Events</div><div class="v">${m.cardCount}</div></div>
       </div>`;
    return wrap;
  }

  /* ---------- group + card builders ---------- */
  // Country band (editorial, top level) and city subheader (nested under a country).
  function countryBand(label, cont) {
    return el('div', 'lcountry-head', esc(label) + (cont ? ' <span class="cont">(cont.)</span>' : ''));
  }
  function groupHead(label, cont) {
    return el('div', 'lgroup-head', esc(label) + (cont ? ' <span class="cont">(cont.)</span>' : ''));
  }

  function thumbHtml(card) {
    if (card.isEvent) {
      return `<div class="lthumb ev"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z"/><path d="M15 6v12" stroke-dasharray="2 2"/></svg></div>`;
    }
    if (card.image) {
      return `<div class="lthumb" style="background-image:url(&quot;${esc(card.image)}&quot;)"></div>`;
    }
    return `<div class="lthumb ph"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg></div>`;
  }

  function badgeHtml(card) {
    if (card.isEvent) return `<span class="lc-event">Event</span>`;
    if (card.career) return `<span class="${careerCls(card.career)}">${esc(card.career.toUpperCase())}</span>`;
    return `<span class="st-undiscovered">—</span>`;
  }

  // Card shell: header + empty show list. Returns { wrap, shows } so the paginator
  // can stream show rows into it (and split a long card across pages).
  function cardShell(card, cont) {
    const wrap = el('div', 'lcard');
    wrap.innerHTML =
      `<div class="lc-head">
         ${thumbHtml(card)}
         <div class="lc-name">${esc(card.name)}${cont ? ' <span class="cont">(cont.)</span>' : ''}</div>
         <div class="lc-badge">${badgeHtml(card)}</div>
       </div>
       <div class="lc-shows"></div>`;
    return { wrap, shows: wrap.querySelector('.lc-shows') };
  }

  function showRow(s) {
    const loc = (s.city || '—') + (s.state ? ', ' + s.state : '');
    const r = el('div', 'lshow');
    r.innerHTML =
      `<span class="d">${esc(s.date)}</span><span class="sep">|</span>` +
      `<span class="loc">${esc(loc)}</span><span class="sep">|</span>` +
      `<span class="ven">${esc(s.venue || '—')}</span>`;
    return r;
  }

  function fullCard(card) {
    const shell = cardShell(card, false);
    card.shows.forEach((s) => shell.shows.appendChild(showRow(s)));
    return shell.wrap;
  }

  /* ---------- pagination ---------- */
  let pages = [];
  let body = null;
  function startSheet(isFirst) {
    const sheet = el('div', 'sheet');
    const b = el('div', 'sheet-body');
    const foot = runfoot();
    if (!isFirst) sheet.appendChild(runhead());
    sheet.appendChild(b);
    sheet.appendChild(foot);
    doc().appendChild(sheet);
    pages.push({ sheet, body: b, foot });
    return b;
  }
  const overflow = (b) => b.scrollHeight > b.clientHeight + 1;

  // Current country/city context (null when not in by-city mode or no header). Used to
  // re-emit continuation headers after a page break so context is never lost.
  let curCountry = null;
  let curCity = null;

  // New page that re-emits the active country band (cont) + city subheader (cont).
  function breakPage() {
    body = startSheet(false);
    if (curCountry) body.appendChild(countryBand(curCountry, true));
    if (curCity) body.appendChild(groupHead(curCity, true));
  }

  // Stream a too-tall card's shows across pages, re-emitting the country band, city
  // subheader, and card header as continuations at each break.
  function splitCard(card) {
    let shell = cardShell(card, false);
    body.appendChild(shell.wrap);
    let sw = shell.shows;
    card.shows.forEach((s) => {
      const row = showRow(s);
      sw.appendChild(row);
      if (overflow(body)) {
        sw.removeChild(row);
        breakPage();
        const next = cardShell(card, true);
        body.appendChild(next.wrap);
        sw = next.shows;
        sw.appendChild(row);
      }
    });
  }

  function render() {
    document.documentElement.style.setProperty('--accent', '#f9d40a');
    const host = doc();
    host.innerHTML = '';
    pages = [];

    body = startSheet(true);
    body.appendChild(masthead());

    (DATA.groups || []).forEach((country) => {
      curCountry = country.countryLabel || null;
      curCity = null;
      if (curCountry) {
        const cb = countryBand(curCountry, false);
        body.appendChild(cb);
        if (overflow(body)) {
          body.removeChild(cb);
          body = startSheet(false);
          body.appendChild(countryBand(curCountry, false));
        }
      }

      (country.cities || []).forEach((city) => {
        curCity = city.label || null;
        if (curCity) {
          const gh = groupHead(curCity, false);
          body.appendChild(gh);
          if (overflow(body)) {
            // City header doesn't fit → new page, re-emit country band (cont), then
            // place this city header fresh (it's the first on the new page).
            body.removeChild(gh);
            body = startSheet(false);
            if (curCountry) body.appendChild(countryBand(curCountry, true));
            body.appendChild(groupHead(curCity, false));
          }
        }

        (city.cards || []).forEach((card) => {
          const node = fullCard(card);
          body.appendChild(node);
          if (overflow(body)) {
            body.removeChild(node);
            breakPage();
            body.appendChild(node);
            if (overflow(body)) {
              // Card too tall for a full page → stream its shows across pages.
              body.removeChild(node);
              splitCard(card);
            }
          }
        });
      });
    });

    const total = pages.length;
    pages.forEach((p, i) => {
      p.foot.querySelector('.pg').textContent = `Page ${i + 1} / ${total}`;
    });
  }

  /* ---------- boot: fonts + images first, then paginate ---------- */
  function preloadImages() {
    const srcs = [];
    (DATA.groups || []).forEach((country) =>
      (country.cities || []).forEach((city) =>
        (city.cards || []).forEach((c) => { if (c.image) srcs.push(c.image); })));
    srcs.push('/report/img/PTY_Logo_Type_URL_Yellow.svg');
    srcs.push('/report/img/PTY_Logo_Type_Yellow.svg');
    return Promise.all(srcs.map((src) => new Promise((res) => {
      const im = new Image();
      im.onload = im.onerror = () => res();
      im.src = src;
    })));
  }

  async function boot() {
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* ignore */ }
    await preloadImages();
    render();
  }

  window.PTYLiveReport = { render, boot };
  document.addEventListener('DOMContentLoaded', boot);
})();
