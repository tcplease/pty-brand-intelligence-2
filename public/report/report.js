/* ===========================================================================
   PTY ARTIST INTELLIGENCE REPORT — renderer + paginator (vanilla)
   window.PTYReport.render(settings) repaints into #doc.
   settings = { layout:'ledger'|'profile', showRank:bool, accent:'#f9d40a' }

   Changes from the design prototype:
   - Renders BOTH layouts (prototype hardcoded ledger).
   - Filters out anything below Mid-Level; drops the non-career "prospect".
   - Per-artist audience (gender skew / lead age / top market) is bound to REAL
     fields (audience_male_pct, age_*_pct, top_countries) instead of a name hash.
   - Waits for webfonts (document.fonts.ready) and preloads thumbnails before
     paginating, so row heights measure correctly and PDF photos aren't blank.
   ======================================================================== */
(function () {
  const DATA = window.PTY_DATA;
  const doc = () => document.getElementById('doc');

  // Logo heights (px). Width auto via the 2.886:1 ratio of the SVGs.
  const MAST_LOGO_H = 48;     // page-1 masthead lockup (URL logo)
  const RUNHEAD_LOGO_H = 28;  // running header, pages 2+ (no-URL logo)

  /* ---------- helpers ---------- */
  function fmtNum(n) {
    if (n == null) return { t: '—', dim: true };
    if (n >= 1e6) {
      let v = n / 1e6;
      return { t: (v >= 10 ? Math.round(v) : v.toFixed(1)) + 'M', dim: false };
    }
    if (n >= 1e3) return { t: Math.round(n / 1e3) + 'K', dim: false };
    return { t: String(n), dim: false };
  }

  // Career-stage rank. Report shows Mid-Level and above only.
  const RANK = { legendary: 5, superstar: 4, mainstream: 3, midlevel: 2, developing: 1, undiscovered: 0 };
  const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  function rankOf(stage) {
    const r = RANK[keyOf(stage)];
    return r == null ? -1 : r; // unknown/null stage → drop (below midlevel cutoff)
  }
  // chip class — pastel print palette in styles.css (deliberately NOT the dark-mode hexes)
  const STAGE_CSS = {
    legendary: 'legendary', superstar: 'superstar', mainstream: 'mainstream',
    midlevel: 'midlevel', developing: 'developing', undiscovered: 'undiscovered'
  };
  function careerCls(stage) {
    return 'st-' + (STAGE_CSS[keyOf(stage)] || 'mainstream');
  }

  // Per-artist audience micro-profile — REAL data, with graceful "—" fallbacks.
  function microProfile(a) {
    const male = a.audience_male_pct != null ? Math.round(a.audience_male_pct) : null;
    const female = male != null ? 100 - male : null;

    const bands = [
      ['13–17', a.age_13_17_pct], ['18–24', a.age_18_24_pct], ['25–34', a.age_25_34_pct],
      ['35–44', a.age_35_44_pct], ['45–64', a.age_45_64_pct], ['65+', a.age_65_plus_pct]
    ].filter((b) => b[1] != null);
    const lead = bands.length ? bands.reduce((m, b) => (b[1] > m[1] ? b : m))[0] : '—';

    let code = '—', place = '', mp = null;
    if (Array.isArray(a.top_countries) && a.top_countries.length) {
      const t = a.top_countries[0];
      code = t.code || '—'; place = t.country || ''; mp = t.pct != null ? Math.round(t.pct) : null;
    } else if (a.primary_market) {
      place = a.primary_market;
    }
    return { male, female, lead, code, place, mp };
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ---------- chrome ---------- */
  function runhead() {
    const h = el('div', 'runhead');
    h.innerHTML =
      `<div class="rh-left"><img src="/report/img/PTY_Logo_Type_Yellow.svg" alt="Please & Thank You" style="height:${RUNHEAD_LOGO_H}px;width:auto;display:block"></div>
       <div class="rh-right">
         <div class="rh-label">Artist Intelligence Report</div>
       </div>`;
    return h;
  }
  function runfoot() {
    const f = el('div', 'runfoot');
    f.innerHTML =
      `<span>Please &amp; Thank You — Confidential</span>
       <span class="pg">—</span>`;
    return f;
  }

  /* ---------- masthead (page 1) ---------- */
  function masthead(shownCount) {
    const m = DATA.meta;
    const wrap = el('div', 'masthead');
    const params = [
      ['Query', m.query],
      ['Target Age', m.ageBands.join(', ')],
      ['Gender', m.gender],
      ['Min Match', m.minMatch + '%'],
      ['Generated', m.generated]
    ].map((p) => `<div class="param"><div class="k">${p[0]}</div><div class="v">${p[1]}</div></div>`).join('');

    wrap.innerHTML =
      `<div class="mast-top">
         <div class="lock"><img src="/report/img/PTY_Logo_Type_URL_Yellow.svg" alt="Please & Thank You" style="height:${MAST_LOGO_H}px;width:auto;display:block"></div>
       </div>
       <div class="mast-title">${m.reportTitle}</div>
       <div class="mast-sub">Artist Intelligence</div>
       <div class="mast-rule"></div>
       <div class="params">
         ${params}
         <div class="param count"><div class="k">Artists</div><div class="v">${shownCount}</div></div>
       </div>`;
    return wrap;
  }

  /* ---------- roster header ---------- */
  function rosterHead(layout) {
    const h = el('div', 'roster-head');
    if (layout === 'profile') {
      h.innerHTML =
        `<div class="num">#</div><div></div><div>Genre / Artist</div>
         <div>Career</div><div>Demo Match</div><div>Affinity</div>
         <div class="soc3">Audience &amp; Reach</div>`;
    } else {
      h.innerHTML =
        `<div></div><div>Artist</div>
         <div>Career Stage</div><div>Demo Match</div><div>Affinity</div>
         <div class="stat">Spotify</div><div class="stat">Instagram</div><div class="stat">TikTok</div>`;
    }
    return h;
  }

  /* ---------- a row ---------- */
  function thumb(a) {
    const t = el('div', 'thumb');
    const src = a.imageUrl || (a.img ? `img/${a.img}.jpg` : '');
    if (src) t.style.backgroundImage = `url("${src}")`;
    return t;
  }
  function careerEl(a) {
    const c = el('div', 'career');
    c.innerHTML = `<span class="${careerCls(a.stage)}">${a.stage}</span>`;
    return c;
  }
  function demoEl(a) {
    const d = el('div', 'demo');
    d.innerHTML = `<div class="top"><span class="pct">${a.demoMatch}</span><span class="u">% DEMO</span></div>
                   <div class="track"><span class="fill" style="width:${a.demoMatch}%"></span></div>`;
    return d;
  }
  function affEl(a) {
    const hi = a.affinity >= 1.5;
    const e = el('div', 'aff' + (hi ? ' hi' : ''));
    e.innerHTML = `${a.affinity.toFixed(1)}<small>×</small>`;
    return e;
  }
  function statEl(n) {
    const f = fmtNum(n);
    return `<div class="stat"><span class="n${f.dim ? ' dim' : ''}">${f.t}</span></div>`;
  }

  function rowLedger(a) {
    const r = el('div', 'row');
    r.appendChild(thumb(a));
    const nm = el('div');
    nm.innerHTML = `<div class="name">${a.name}</div><div class="genre">${a.genre}</div>`;
    r.appendChild(nm);
    r.appendChild(careerEl(a));
    r.appendChild(demoEl(a));
    r.appendChild(affEl(a));
    const w = el('div');
    w.innerHTML = statEl(a.spotify) + statEl(a.instagram) + statEl(a.tiktok);
    while (w.firstChild) r.appendChild(w.firstChild);
    return r;
  }

  function rowProfile(a, rank, showRank) {
    const mp = microProfile(a);
    const r = el('div', 'row');
    r.appendChild(el('div', 'rk', showRank ? String(rank) : ''));
    r.appendChild(thumb(a));
    const nm = el('div');
    nm.innerHTML = `<div class="name">${a.name}</div><div class="genre">${a.genre}</div>`;
    r.appendChild(nm);
    r.appendChild(careerEl(a));
    r.appendChild(demoEl(a));
    r.appendChild(affEl(a));

    const s = el('div', 'austrip');
    const sp = fmtNum(a.spotify), ig = fmtNum(a.instagram), tt = fmtNum(a.tiktok);
    const genderTxt = mp.male != null ? `${mp.male}M · ${mp.female}F · ${mp.lead}` : `Lead age ${mp.lead}`;
    const barWidth = mp.male != null ? mp.male : 0;
    const mktRight = mp.mp != null ? `${mp.mp}%` : '';
    s.innerHTML =
      `<div class="mkt"><span class="code">${mp.code}</span><span class="place">${mp.place}</span><span class="mp">${mktRight}</span></div>
       <div class="gen"><span class="gbar"><i style="width:${barWidth}%"></i></span><span class="gt">${genderTxt}</span></div>
       <div class="soctrio">
         <div><span class="pl">Spotify</span><span class="vv${sp.dim ? ' dim' : ''}">${sp.t}</span></div>
         <div><span class="pl">Instagram</span><span class="vv${ig.dim ? ' dim' : ''}">${ig.t}</span></div>
         <div><span class="pl">TikTok</span><span class="vv${tt.dim ? ' dim' : ''}">${tt.t}</span></div>
       </div>`;
    r.appendChild(s);
    return r;
  }

  /* ---------- pagination ---------- */
  let pages = [];
  function startSheet(isFirst) {
    const sheet = el('div', 'sheet');
    const body = el('div', 'sheet-body');
    const foot = runfoot();
    if (!isFirst) sheet.appendChild(runhead());
    sheet.appendChild(body);
    sheet.appendChild(foot);
    doc().appendChild(sheet);
    pages.push({ sheet, body, foot });
    return body;
  }
  const overflow = (body) => body.scrollHeight > body.clientHeight + 1;

  /* ---------- main render ---------- */
  let current = { layout: 'ledger', showRank: true, accent: '#f9d40a' };

  function render(settings) {
    current = Object.assign({}, current, settings || {});
    const layout = current.layout === 'profile' ? 'profile' : 'ledger';

    document.documentElement.style.setProperty('--accent', current.accent);
    document.body.className = 'layout-' + layout;

    const host = doc();
    host.innerHTML = '';
    pages = [];

    // Mid-Level and above only, sorted by demo match desc then affinity desc.
    const artists = DATA.artists
      .filter((a) => rankOf(a.stage) >= RANK.midlevel)
      .sort((a, b) => b.demoMatch - a.demoMatch || b.affinity - a.affinity);

    let body = startSheet(true);
    body.appendChild(masthead(artists.length));
    body.appendChild(rosterHead(layout));

    artists.forEach((a, i) => {
      const row = layout === 'profile'
        ? rowProfile(a, i + 1, current.showRank)
        : rowLedger(a);
      body.appendChild(row);
      if (overflow(body)) {
        body.removeChild(row);
        body = startSheet(false);
        body.appendChild(rosterHead(layout));
        body.appendChild(row);
      }
    });

    const total = pages.length;
    pages.forEach((p, i) => {
      p.foot.querySelector('.pg').textContent = `Page ${i + 1} / ${total}`;
    });
  }

  /* ---------- boot: fonts + images first, then paginate ---------- */
  function preloadImages(list) {
    const srcs = list.map((a) => a.imageUrl || (a.img ? `img/${a.img}.jpg` : '')).filter(Boolean);
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
    await preloadImages(DATA.artists);
    render(current);
  }

  window.PTYReport = { render, boot };
  document.addEventListener('DOMContentLoaded', boot);
})();
