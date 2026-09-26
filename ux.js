/* CREATIVE INSIGHT UX layer v1 (2026-09-26)
 * - URL routing (#d=, #v=, #q=, #a=) so back/refresh/share work
 * - daily brief (curator note + keywords linked to cards + read progress + "since last visit")
 * - compact date picker (month-grouped) instead of 117 flat buttons
 * - in-site reader (summary, curator view, techniques, related issues, original link)
 * - read state, fixed MY ARCHIVE (all dates), linked WEEKLY TREND, full-field search, paged POPCORN/CREATORS
 */
window.UX_BOOTED = true;
(function () {
  'use strict';

  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  var ORIG = { renderAgentLog: window.renderAgentLog };
  var VIEWS = ['day', 'creators', 'popcorn', 'trend', 'archive', 'agentlog', 'search'];
  var DAYS = {}, DAY_P = {}, ITEMS = {};
  var ALL_P = null, allLoaded = false;
  var READ = LS.get('ci_read', {});
  var state = { v: 'day', d: '', f: 'ALL', q: '', a: '' };
  var lastDay = '';
  var listCtx = [];
  var readerPushed = false;
  var renderSeq = 0;
  var popLimit = 7, creLimit = 5;
  var prevSeen = null, newDates = [], firstVisit = false;
  var activeKw = '';
  var unreadOnly = LS.get('ci_unread_only', false);
  var lastOpen = '';
  function hlText(txt, toks) {
    var out = e(txt);
    (toks || []).forEach(function (t) {
      var et = e(t); if (!et) return;
      out = out.replace(new RegExp(et.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), function (m) { return '<mark>' + m + '</mark>'; });
    });
    return out;
  }
  function chipQ(t) { return String(t || '').replace(/^#+/, '').replace(/\s*\(.*$/, '').trim(); }
  window.uxChip = function (ev, q) { ev.preventDefault(); ev.stopPropagation(); searchArchiveKeyword(q); return false; };

  /* ---------------- helpers ---------------- */
  function hid(url) { var h = 5381; url = String(url || ''); for (var i = 0; i < url.length; i++) { h = (((h << 5) + h) + url.charCodeAt(i)) >>> 0; } return h.toString(36); }
  function e(s) { return (s === null || s === undefined) ? '' : esc(String(s)); }
  function jsq(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  function dateIdx(d) { return MANIFEST_DATES.indexOf(d); }
  function latest() { return MANIFEST_DATES[0]; }
  function dayItems(entry) { return (entry && (entry.topPicks || []).concat(entry.items || [])) || []; }
  function wk(d) { try { return ['일', '월', '화', '수', '목', '금', '토'][new Date(d + 'T00:00:00').getDay()]; } catch (x) { return ''; } }
  function short(d) { return d ? d.slice(5).replace('-', '.') : ''; }
  function isPlaceholder(u) { return !u || String(u).indexOf('http') !== 0 || /placehold\.co|via\.placeholder|dummyimage/.test(u); }
  function srcName(p) {
    var s = (p.source || '').trim();
    if (!s || /unknown/i.test(s)) { try { s = new URL(p.url).hostname.replace(/^www\./, ''); } catch (x) { s = 'SOURCE'; } }
    return s;
  }
  function domLabel(d) { return ({ T01: 'VISUALS', T02: 'PROCESS', T03: 'TECH & AI', T04: 'DESIGN', T05: 'TREND' })[d] || d || ''; }
  function cleanQ(q) { return String(q || '').replace(/^Agent's Thought:\s*/, '').replace(/^큐레이터의 메시지:\s*/, ''); }
  function loadingHTML(msg) { return '<div class="ux-empty">' + e(msg) + '</div>'; }
  function notes() { return LS.get('creative_insights_notes', {}); }
  function isSaved(url) { return savedUrls.indexOf(url) !== -1; }
  function heartSVG(on) {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="' + (on ? '#ff3366' : 'transparent') + '" stroke="' + (on ? '#ff3366' : '#ccc') + '" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
  }
  function hayOf(p) {
    return [p.title_ko, p.title, p.content, p.summary, p.why, p.creator_name, p.creator_insight, p.domain, p.category, p.source,
      (p.tags || []).join(' '), (p.execution_techniques || []).join(' ')].join(' ').toLowerCase();
  }
  var STOP = { '의': 1, '과': 1, '와': 1, '및': 1, '기반': 1, '중심': 1, 'the': 1, 'and': 1, 'of': 1 };
  function kwTokens(word) {
    return String(word || '').toLowerCase().replace(/[#()\[\]·,\/]/g, ' ').split(/[\s-]+/)
      .map(function (t) { return t.replace(/(의|과|와|을|를|적)$/, function (m, g, off, str) { return str.length > 2 ? '' : m; }); })
      .filter(function (t) { return t.length >= 2 && !STOP[t]; });
  }
  function tokHit(t, hay) {
    if (hay.indexOf(t) !== -1) return 2;
    if (t.length >= 3 && hay.indexOf(t.slice(0, t.length - 1)) !== -1) return 1;
    return 0;
  }
  /* scorer that ignores tokens too common in the pool (e.g. "브랜드" in a brand-heavy day) */
  function makeScorer(pool) {
    var hays = pool.map(hayOf), cache = {};
    function common(t) {
      if (cache[t] !== undefined) return cache[t];
      var n = 0; hays.forEach(function (h) { if (tokHit(t, h)) n++; });
      cache[t] = pool.length >= 6 && n / pool.length > 0.34;
      return cache[t];
    }
    return function (word, p) {
      var hay = hayOf(p), s = 0;
      kwTokens(word).forEach(function (t) { if (!common(t)) s += tokHit(t, hay); });
      return s;
    };
  }
  function kwScore(word, p) { return (kwScore.cur || makeScorer([]))(word, p); }

  /* ---------------- data ---------------- */
  function register(date, entry) {
    DAYS[date] = entry;
    var i = dateIdx(date);
    if (i >= 0) DATA.history[i] = entry;
    window.allArticlesMap = window.allArticlesMap || {};
    dayItems(entry).concat(entry.popcorn || []).forEach(function (it) {
      if (!it || !it.url) return;
      var id = hid(it.url);
      if (!ITEMS[id]) ITEMS[id] = { item: it, date: date, id: id };
      window.allArticlesMap[it.url] = it;
    });
  }
  function loadDay(date) {
    if (DAYS[date]) return Promise.resolve(DAYS[date]);
    if (DAY_P[date]) return DAY_P[date];
    var fresh = dateIdx(date) <= 1;
    var url = 'data/daily/' + date + '.json?' + (fresh ? 't=' + Date.now() : 'v=' + latest());
    DAY_P[date] = fetch(url, fresh ? { cache: 'no-store' } : {})
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (entry) { register(date, entry); return entry; })
      .catch(function (err) { delete DAY_P[date]; throw err; });
    return DAY_P[date];
  }
  function loadAll() {
    if (ALL_P) return ALL_P;
    var queue = MANIFEST_DATES.slice(), workers = [];
    function next() { var d = queue.shift(); if (!d) return Promise.resolve(); return loadDay(d).catch(function () {}).then(next); }
    for (var w = 0; w < 8; w++) workers.push(next());
    ALL_P = Promise.all(workers).then(function () { allLoaded = true; return true; });
    return ALL_P;
  }

  /* ---------------- router ---------------- */
  function defaults() { return { v: 'day', d: lastDay || latest(), f: 'ALL', q: '', a: '' }; }
  function toHash(s) {
    var p = [];
    if (s.v !== 'day') p.push('v=' + encodeURIComponent(s.v));
    if (s.v === 'day' && s.d && s.d !== latest()) p.push('d=' + s.d);
    if (s.v === 'day' && s.f && s.f !== 'ALL') p.push('f=' + encodeURIComponent(s.f));
    if (s.v === 'search' && s.q) p.push('q=' + encodeURIComponent(s.q));
    if (s.a) p.push('a=' + s.a);
    return p.length ? '#' + p.join('&') : location.pathname + location.search;
  }
  function parseHash() {
    var s = { v: 'day', d: latest(), f: 'ALL', q: '', a: '' };
    var h = location.hash.replace(/^#/, '');
    if (!h) return s;
    if (/^archive/.test(h)) { s.v = 'archive'; return s; }
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i < 0) return;
      var k = kv.slice(0, i), v = '';
      try { v = decodeURIComponent(kv.slice(i + 1)); } catch (x) { v = kv.slice(i + 1); }
      if (Object.prototype.hasOwnProperty.call(s, k)) s[k] = v;
    });
    if (VIEWS.indexOf(s.v) === -1) s.v = 'day';
    if (dateIdx(s.d) === -1) s.d = latest();
    return s;
  }
  function sameBase(a, b) { return a.v === b.v && a.d === b.d && a.f === b.f && a.q === b.q; }
  var SCROLL = {};
  function hkey() { return location.hash || '#'; }
  function navigate(ns, opts) {
    opts = opts || {};
    SCROLL[hkey()] = window.scrollY;
    var base = defaults();
    Object.keys(ns).forEach(function (k) { base[k] = ns[k]; });
    state = base;
    readerPushed = false;
    if (opts.replace) history.replaceState(null, '', toHash(state)); else history.pushState(null, '', toHash(state));
    return renderState({ scroll: opts.scroll !== false });
  }
  window.addEventListener('popstate', function () {
    var ns = parseHash();
    var onlyReader = sameBase(ns, state);
    state = ns;
    readerPushed = false;
    if (onlyReader) { syncReader(); return; }
    var y = SCROLL[hkey()];
    renderState({ scroll: y === undefined }).then(function () { if (y !== undefined) setTimeout(function () { window.scrollTo(0, y); }, 60); });
  });

  /* ---------------- nav (overrides) ---------------- */
  window.renderDateTabs = function () {
    var s = state, d = (s.v === 'day' ? s.d : (lastDay || latest())), i = dateIdx(d);
    var feats = [['creators', "✨ CREATORS' INSIGHT", 'var(--acc)'], ['popcorn', '🍿 POPCORN', '#ff0055'], ['trend', '📈 WEEKLY TREND', '#1da1f2'], ['archive', '♥ MY ARCHIVE', '#ff3366'], ['agentlog', '🧠 AGENT LOG', '#8a5cf6']];
    var h = '<div class="ux-nav-feats"><button class="dtab' + (s.v === 'day' ? ' on' : '') + '" onclick="uxGoDay(\'' + d + '\')" style="font-weight:700;">📰 DAILY ISSUE</button></div>';
    h += '<div class="ux-datepick">';
    h += '<button class="ux-arrow" ' + (i >= MANIFEST_DATES.length - 1 ? 'disabled' : '') + ' onclick="uxStep(1)" title="이전 호">‹</button>';
    h += '<select class="' + (s.v === 'day' ? 'is-on' : '') + '" onchange="uxGoDay(this.value)" aria-label="발행일 선택">';
    var curMonth = '';
    MANIFEST_DATES.forEach(function (ds) {
      var m = ds.slice(0, 7);
      if (m !== curMonth) { if (curMonth) h += '</optgroup>'; curMonth = m; h += '<optgroup label="' + m.slice(0, 4) + '년 ' + parseInt(m.slice(5), 10) + '월">'; }
      var isNew = newDates.indexOf(ds) !== -1;
      h += '<option value="' + ds + '"' + (ds === d ? ' selected' : '') + '>' + fmtDate(ds) + ' (' + wk(ds) + ')' + (ds === latest() ? ' · 최신' : '') + (isNew ? ' · NEW' : '') + '</option>';
    });
    if (curMonth) h += '</optgroup>';
    h += '</select>';
    h += '<button class="ux-arrow" ' + (i <= 0 ? 'disabled' : '') + ' onclick="uxStep(-1)" title="다음 호">›</button>';
    if (i > 0) h += '<button class="ux-today" onclick="uxGoDay(\'' + latest() + '\')">최신호</button>';
    if (newDates.length && s.v === 'day' && d === latest()) h += '<span class="ux-newdot">NEW ' + newDates.length + '</span>';
    h += '</div><div class="ux-nav-sep"></div><div class="ux-nav-feats">';
    feats.forEach(function (f) { h += '<button class="dtab' + (s.v === f[0] ? ' on' : '') + '" onclick="setSpecialView(\'' + f[0] + '\')" style="color:' + f[2] + '; font-weight:700;">' + f[1] + '</button>'; });
    h += '</div>';
    document.getElementById('dateTabs').innerHTML = h;
  };
  window.uxGoDay = function (d) { if (dateIdx(d) === -1) return; navigate({ v: 'day', d: d }); };
  window.uxStep = function (delta) { var d = (state.v === 'day' ? state.d : lastDay) || latest(); var i = dateIdx(d) + delta; if (i < 0 || i >= MANIFEST_DATES.length) return; uxGoDay(MANIFEST_DATES[i]); };

  window.renderDomainTabs = function () {
    var tt = document.getElementById('threadTabs');
    var entry = DAYS[state.d];
    if (state.v !== 'day' || !entry) { tt.innerHTML = ''; return; }
    var items = dayItems(entry), counts = {};
    items.forEach(function (p) { var t = p.domain || p.thread; if (t) counts[t] = (counts[t] || 0) + 1; });
    var h = '<button class="ttab ' + (state.f === 'ALL' ? 'on' : '') + '" onclick="setDom(\'ALL\')">ALL (' + items.length + ')</button>';
    Object.keys(counts).sort().forEach(function (k) {
      h += '<button class="ttab ' + (state.f === k ? 'on' : '') + '" onclick="setDom(\'' + jsq(k) + '\')">' + e(domLabel(k)) + ' (' + counts[k] + ')</button>';
    });
    tt.innerHTML = h;
  };

  window.setDi = function (i) { var d = MANIFEST_DATES[i]; if (d) return navigate({ v: 'day', d: d }); };
  window.setSpecialView = function (v) { if (!v || v === 'day') return uxGoDay(lastDay || latest()); if (v === 'creators') creLimit = 5; if (v === 'popcorn') popLimit = 7; return navigate({ v: v }); };
  window.setDom = function (t) { return navigate({ v: 'day', d: state.d, f: t }, { replace: true, scroll: false }); };
  window.searchArchiveKeyword = function (kw) { kw = (kw || '').trim(); if (!kw) return; return navigate({ v: 'search', q: kw }, { replace: state.v === 'search' }); };
  window.searchArchive = function () { window.searchArchiveKeyword(document.getElementById('searchInput').value); };
  window.renderMain = function () { renderState({ scroll: false }); };
  window.renderArchive = function () { renderState({ scroll: false }); };
  window.renderPopcorn = function () { renderState({ scroll: false }); };
  window.renderCreatorsInsight = function () { renderState({ scroll: false }); };

  /* ---------------- main render ---------------- */
  function renderState(opts) {
    var seq = ++renderSeq, s = state, main = document.getElementById('main');
    specialView = (s.v === 'day') ? null : s.v;
    if (s.v === 'search') currentSearchKeyword = s.q;
    if (s.v === 'day') { lastDay = s.d; di = Math.max(0, dateIdx(s.d)); domFilter = s.f || 'ALL'; }
    document.getElementById('hdate').innerText = fmtDate(s.v === 'day' ? s.d : latest()) + ' ISSUE';
    var si = document.getElementById('searchInput');
    if (si && document.activeElement !== si) si.value = (s.v === 'search' ? s.q : '');
    window.renderDateTabs();
    var p;
    if (s.v === 'day') {
      if (!DAYS[s.d]) main.innerHTML = loadingHTML('이슈를 불러오는 중...');
      p = loadDay(s.d).then(function (entry) {
        if (seq !== renderSeq) return;
        document.documentElement.style.setProperty('--acc', entry.dominant_color || '#ff3366');
        window.renderDomainTabs();
        renderDay(entry);
        document.title = 'CREATIVE INSIGHT · ' + fmtDate(s.d);
      });
    } else {
      document.getElementById('threadTabs').innerHTML = '';
      var titles = { creators: "Creators' Insight", popcorn: 'Popcorn', trend: 'Weekly Trend', archive: 'My Archive', agentlog: 'Agent Log', search: '검색: ' + s.q };
      document.title = 'CREATIVE INSIGHT · ' + titles[s.v];
      if (s.v === 'agentlog') {
        p = Promise.resolve(ORIG.renderAgentLog && ORIG.renderAgentLog());
      } else {
        if (!allLoaded) main.innerHTML = loadingHTML('전체 아카이브(' + MANIFEST_DATES.length + '개 호)를 불러오는 중...');
        p = loadAll().then(function () {
          if (seq !== renderSeq) return;
          if (s.v === 'archive') renderArchiveX();
          else if (s.v === 'popcorn') renderPopcornX();
          else if (s.v === 'creators') renderCreatorsX();
          else if (s.v === 'trend') renderTrendX();
          else if (s.v === 'search') renderSearchX(s.q);
        });
      }
    }
    return Promise.resolve(p).catch(function (err) {
      console.error(err);
      main.innerHTML = loadingHTML('데이터를 불러오지 못했습니다. 잠시 후 새로고침해주세요.');
    }).then(function () {
      if (seq !== renderSeq) return;
      if (opts && opts.scroll) window.scrollTo(0, 0);
      if (state.a && !ITEMS[state.a]) loadAll().then(syncReader); else syncReader();
    });
  }

  /* ---------------- card ---------------- */
  function cardHTML(p, date, opts) {
    opts = opts || {};
    var id = hid(p.url), read = !!READ[id], saved = isSaved(p.url), delay = Math.min((opts.i || 0) * 0.05, 0.6).toFixed(2);
    var h = '<a href="' + e(p.url) + '" target="_blank" rel="noopener" class="pick ux-card' + (read ? ' is-read' : '') + '" data-id="' + id + '" style="animation-delay:' + delay + 's" onclick="return uxCardClick(event,\'' + id + '\')">';
    if (!isPlaceholder(p.image)) {
      h += '<div class="pick-img-wrap"><img loading="lazy" src="' + e(p.image) + '" alt="" onerror="this.parentElement.style.display=\'none\'">';
      h += '<div class="pick-img-overlay">' + (p.creator_name ? '<span class="overlay-creator">By ' + e(p.creator_name) + '</span>' : '') + '<span class="overlay-text">요약 · 관점 보기</span></div></div>';
    } else {
      h += '<div class="ux-noimg"></div>';
    }
    h += '<div class="pick-meta"><span class="pick-src">' + e(srcName(p)) + '</span>' + (read ? '<span class="ux-read">읽음</span>' : '') + (opts.showDate ? '<span class="pick-date">' + fmtDate(date) + '</span>' : '') + '</div>';
    h += '<div class="pick-ko">' + hlText(p.title_ko || p.title, opts.hl) + '</div>';
    h += '<button class="save-btn" data-save-id="' + id + '" onclick="uxSave(event,\'' + id + '\')" title="아카이브에 저장" style="position:absolute; right:0; top:' + (isPlaceholder(p.image) ? '-12px' : '12px') + '; margin-right:12px; background:rgba(255,255,255,0.95); border:none; border-radius:50%; width:32px; height:32px; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 2px 5px rgba(0,0,0,0.1); z-index:10;">' + heartSVG(saved) + '</button>';
    var sum = p.content || p.summary;
    if (sum) h += '<div class="ux-sum">' + hlText(sum, opts.hl) + '</div>';
    if (p.why) h += '<div class="pick-why">' + hlText(p.why, opts.hl) + '</div>';
    if (p.social_proof) h += '<div class="pick-social">🏆 ' + e(p.social_proof) + '</div>';
    if (opts.note) h += '<div class="ux-mynote">💭 나의 통찰: ' + e(opts.note) + '</div>';
    h += '<div class="pick-bot">';
    var dom = p.domain || p.thread;
    if (dom) h += '<span class="chip' + (dom === 'POPCORN' ? ' chip-popcorn' : '') + '">' + e(domLabel(dom)) + '</span>';
    if (p.category) h += '<span class="chip">' + e(p.category) + '</span>';
    (p.execution_techniques || []).slice(0, 3).forEach(function (t) { h += '<span class="chip chip-technique ux-chip" title="이 기법으로 아카이브 검색" onclick="return uxChip(event,\'' + e(jsq(chipQ(t))) + '\')">#' + e((t || '').replace(/^#+/, '')) + '</span>'; });
    h += '</div></a>';
    return h;
  }
  window.uxCardClick = function (ev, id) {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button === 1) { markRead(id); return true; }
    ev.preventDefault();
    openReader(id);
    return false;
  };
  function markRead(id) {
    if (!READ[id]) { READ[id] = Date.now(); LS.set('ci_read', READ); }
    var c = document.querySelectorAll('.ux-card[data-id="' + id + '"]');
    for (var i = 0; i < c.length; i++) {
      if (!c[i].classList.contains('is-read')) {
        c[i].classList.add('is-read');
        var m = c[i].querySelector('.pick-meta .pick-src');
        if (m && !c[i].querySelector('.ux-read')) m.insertAdjacentHTML('afterend', '<span class="ux-read">읽음</span>');
      }
    }
    updateProgress();
  }
  function updateProgress() {
    var el = document.getElementById('uxProgress'); if (!el || !DAYS[state.d]) return;
    var items = dayItems(DAYS[state.d]), n = items.filter(function (p) { return READ[hid(p.url)]; }).length;
    el.innerHTML = '읽음 <b>' + n + '/' + items.length + '</b> <i><u style="width:' + Math.round(100 * n / Math.max(1, items.length)) + '%"></u></i>';
  }

  /* ---------------- day view ---------------- */
  function renderDay(entry) {
    var d = state.d, items = dayItems(entry);
    var picks = state.f === 'ALL' ? items : items.filter(function (x) { return (x.domain || x.thread) === state.f; });
    var readN = items.filter(function (p) { return READ[hid(p.url)]; }).length;
    if (unreadOnly && readN) picks = picks.filter(function (p) { return !READ[hid(p.url)]; });
    listCtx = picks.map(function (p) { return hid(p.url); });
    activeKw = '';
    kwScore.cur = makeScorer(items);
    var h = '';
    if (firstVisit && !LS.get('ci_onboarded', false)) {
      h += '<div class="ux-onboard" id="uxOnboard"><button onclick="uxDismissOnboard()">닫기</button>';
      h += '<b>CREATIVE INSIGHT 사용법</b> · 매일 아침 큐레이터 에이전트가 영상·디자인·브랜드 소식 중 연출가에게 쓸모 있는 것만 골라 관점을 붙입니다.';
      h += '<ol><li>카드를 누르면 원문으로 바로 나가지 않고 <b>요약 · 큐레이터 관점 · 연결된 이슈</b>가 먼저 열립니다. 원문은 그 안의 버튼으로.</li>';
      h += '<li><b>오늘의 키워드</b>를 누르면 그 흐름에 해당하는 카드만 강조됩니다.</li>';
      h += '<li>♥ 로 저장하면 MY ARCHIVE에 한 줄 생각과 함께 쌓이고, 🧠 버튼으로 큐레이터에게 직접 물을 수 있습니다.</li></ol></div>';
    }
    if (newDates.length && d === latest()) {
      h += '<div class="ux-since">지난 방문 이후 <b>' + newDates.length + '개 호</b>가 새로 발행됐어요.';
      newDates.slice(0, 6).forEach(function (nd) { h += '<button onclick="uxGoDay(\'' + nd + '\')">' + short(nd) + ' (' + wk(nd) + ')</button>'; });
      h += '</div>';
    }
    h += '<section class="ux-brief">';
    h += '<div class="ux-brief-top"><span><b>' + fmtDate(d) + '</b> ISSUE</span><span>' + items.length + ' PICKS</span><span class="ux-progress" id="uxProgress"></span>';
    if (readN < items.length) h += '<button class="ux-mini primary" onclick="uxResume()">' + (readN ? '이어 읽기 ▶' : '처음부터 읽기 ▶') + '</button>';
    else h += '<span class="ux-done">✓ 이 호를 다 읽었어요</span>';
    if (readN) h += '<button class="ux-mini' + (unreadOnly ? ' on' : '') + '" onclick="uxToggleUnread()">' + (unreadOnly ? '전체 보기' : '안 읽은 것만') + '</button>';
    h += '</div>';
    if (entry.focusQ) h += '<div class="ux-brief-note" onclick="this.classList.toggle(\'open\')">' + e(cleanQ(entry.focusQ)) + '</div>';
    var kws = entry.macro_keywords || [];
    if (kws.length) {
      h += '<div class="ux-brief-kw"><span class="ux-label">오늘의 키워드</span>';
      kws.forEach(function (k) {
        var n = items.filter(function (p) { return kwScore(k.word, p) > 0; }).length;
        h += '<button class="ux-kw' + (k.is_hot ? ' hot' : '') + '" data-kw="' + e(k.word) + '" onclick="uxKw(this)">' + (k.is_hot ? '🔥 ' : '#') + e(k.word) + (n ? '<small>' + n + '</small>' : '') + '</button>';
      });
      h += '</div><div class="ux-kw-hint" id="uxKwHint"></div>';
    }
    h += '</section>';
    if (picks.length) {
      h += '<div class="picks">';
      picks.forEach(function (p, i) { h += cardHTML(p, d, { i: i }); });
      h += '</div>';
    } else {
      h += '<div class="ux-grid-empty">이 분류에는 오늘 이슈가 없습니다.</div>';
    }
    var i2 = dateIdx(d), older = MANIFEST_DATES[i2 + 1], newer = MANIFEST_DATES[i2 - 1];
    h += '<div class="ux-issue-nav">';
    h += older ? '<button onclick="uxGoDay(\'' + older + '\')">‹ 이전 호<b>' + fmtDate(older) + ' (' + wk(older) + ')</b></button>' : '<span></span>';
    h += newer ? '<button onclick="uxGoDay(\'' + newer + '\')">다음 호 ›<b>' + fmtDate(newer) + ' (' + wk(newer) + ')</b></button>' : '<span></span>';
    h += '</div>';
    document.getElementById('main').innerHTML = h;
    updateProgress();
  }
  window.uxDismissOnboard = function () { LS.set('ci_onboarded', true); var o = document.getElementById('uxOnboard'); if (o) o.remove(); };
  window.uxKw = function (btn) {
    var word = btn.getAttribute('data-kw');
    var cards = document.querySelectorAll('#main .ux-card'), hint = document.getElementById('uxKwHint');
    var all = document.querySelectorAll('.ux-kw'); for (var j = 0; j < all.length; j++) all[j].classList.remove('on');
    if (activeKw === word) {
      activeKw = '';
      for (var i = 0; i < cards.length; i++) cards[i].classList.remove('ux-dim');
      if (hint) hint.innerHTML = '';
      return;
    }
    activeKw = word; btn.classList.add('on');
    var first = null, n = 0;
    for (var k = 0; k < cards.length; k++) {
      var it = ITEMS[cards[k].getAttribute('data-id')];
      var hit = it && kwScore(word, it.item) > 0;
      cards[k].classList.toggle('ux-dim', !hit);
      if (hit) { n++; if (!first) first = cards[k]; }
    }
    if (hint) hint.innerHTML = n ? '“' + e(word) + '” 흐름과 연결된 카드 ' + n + '개를 강조했습니다. 다시 누르면 해제.' : '“' + e(word) + '”는 오늘 이슈 전체에서 도출된 흐름이라 특정 카드와 직접 연결되지 않습니다.';
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /* ---------------- reader ---------------- */
  function ensureReader() {
    var r = document.getElementById('uxReader');
    if (r) return r;
    r = document.createElement('div');
    r.id = 'uxReader'; r.className = 'ux-reader'; r.setAttribute('role', 'dialog'); r.setAttribute('aria-modal', 'true');
    r.innerHTML = '<div class="ux-reader-backdrop" onclick="uxCloseReader()"></div><article class="ux-reader-panel"><div class="ux-reader-bar" id="uxReaderBar"></div><div class="ux-reader-body" id="uxReaderBody"></div></article>';
    document.body.appendChild(r);
    return r;
  }
  function openReader(id) {
    if (!ITEMS[id]) return;
    state.a = id;
    history.pushState(null, '', toHash(state));
    readerPushed = true;
    syncReader();
  }
  window.uxOpen = function (id, replace) {
    if (!ITEMS[id]) return;
    if (replace && state.a) { state.a = id; history.replaceState(null, '', toHash(state)); syncReader(); }
    else openReader(id);
  };
  window.uxCloseReader = function () {
    if (readerPushed) { readerPushed = false; history.back(); return; }
    state.a = ''; history.replaceState(null, '', toHash(state)); syncReader();
  };
  function related(id, limit) {
    var src = ITEMS[id].item, out = [];
    var tags = (src.tags || []).map(function (t) { return String(t).toLowerCase(); });
    var tech = (src.execution_techniques || []).map(function (t) { return String(t).replace(/^#+/, '').toLowerCase(); });
    var GENERIC = { design: 1, visual: 1, visuals: 1, framing: 1, based: 1, driven: 1, brand: 1, style: 1, layout: 1, media: 1, digital: 1, video: 1, marketing: 1, campaign: 1, narrative: 1, cinematic: 1, analysis: 1, strategy: 1 };
    var techWords = {};
    tech.forEach(function (t) { t.split(/[\s\-()\/]+/).forEach(function (w) { if (w.length >= 5 && !GENERIC[w]) techWords[w] = 1; }); });
    var titleKey = String(src.title_ko || src.title || '').trim().toLowerCase();
    Object.keys(ITEMS).forEach(function (k) {
      if (k === id) return;
      var o = ITEMS[k].item;
      if (String(o.title_ko || o.title || '').trim().toLowerCase() === titleKey) return;
      var s = 0, why = [];
      (o.tags || []).forEach(function (t) { if (tags.indexOf(String(t).toLowerCase()) !== -1) { s += 3; why.push('#' + t); } });
      (o.execution_techniques || []).forEach(function (t) {
        var tl = String(t).replace(/^#+/, '').toLowerCase();
        if (tech.indexOf(tl) !== -1) { s += 3; why.push('#' + t.replace(/^#+/, '')); }
        else tl.split(/[\s\-()\/]+/).forEach(function (w) { if (techWords[w]) { s += 1; why.push(w); } });
      });
      if (src.creator_name && o.creator_name && src.creator_name === o.creator_name) { s += 4; why.push(o.creator_name); }
      if (s >= 3) out.push({ id: k, s: s + ((o.domain === src.domain) ? 0.5 : 0), why: why, date: ITEMS[k].date });
    });
    out.sort(function (a, b) { return b.s - a.s || (a.date < b.date ? 1 : -1); });
    if (out.length < 3) {
      /* loose pass: tag/technique words found anywhere in other items' text, ignoring words common across the archive */
      var keys = Object.keys(ITEMS), N = keys.length, have = {};
      out.forEach(function (x) { have[x.id] = 1; });
      var probes = [];
      tags.forEach(function (t) { var n = t.replace(/\s+/g, ''); if (n.length >= 2) probes.push({ t: n, ns: true, w: 1.5, label: '#' + t }); });
      Object.keys(techWords).forEach(function (w) { probes.push({ t: w, ns: false, w: 1, label: w }); });
      probes.forEach(function (pr) {
        var df = 0;
        keys.forEach(function (k) { if ((pr.ns ? hayNS(k) : hayK(k)).indexOf(pr.t) !== -1) df++; });
        pr.ok = df > 1 && df / N < 0.03;
      });
      var loose = [];
      keys.forEach(function (k) {
        if (k === id || have[k]) return;
        var o = ITEMS[k].item;
        if (String(o.title_ko || o.title || '').trim().toLowerCase() === titleKey) return;
        var s = 0, why = [];
        probes.forEach(function (pr) { if (pr.ok && (pr.ns ? hayNS(k) : hayK(k)).indexOf(pr.t) !== -1) { s += pr.w; why.push(pr.label); } });
        if (s >= 1.5) loose.push({ id: k, s: s, why: why, date: ITEMS[k].date });
      });
      loose.sort(function (a, b) { return b.s - a.s || (a.date < b.date ? 1 : -1); });
      out = out.concat(loose);
    }
    return out.slice(0, limit || 4);
  }
  function hayK(k) { var r = ITEMS[k]; if (!r.hay) r.hay = hayOf(r.item); return r.hay; }
  function hayNS(k) { var r = ITEMS[k]; if (!r.hayns) r.hayns = hayK(k).replace(/\s+/g, ''); return r.hayns; }
  function syncReader() {
    var r = ensureReader();
    var id = state.a;
    if (!id || !ITEMS[id]) {
      var wasOpen = r.classList.contains('open');
      r.classList.remove('open'); document.documentElement.style.overflow = ''; document.body.classList.remove('ux-reading');
      if (wasOpen && lastOpen) flashCard(lastOpen);
      lastOpen = '';
      return;
    }
    lastOpen = id;
    document.body.classList.add('ux-reading');
    var rec = ITEMS[id], p = rec.item;
    var pos = listCtx.indexOf(id);
    var bar = '';
    bar += '<button class="ux-rbtn" ' + (pos > 0 ? '' : 'disabled') + ' onclick="uxReaderStep(-1)" title="이전 기사 (←)">‹ 이전</button>';
    bar += '<span class="pos">' + (pos >= 0 ? (pos + 1) + ' / ' + listCtx.length : '') + '</span>';
    bar += '<button class="ux-rbtn" ' + (pos >= 0 && pos < listCtx.length - 1 ? '' : 'disabled') + ' onclick="uxReaderStep(1)" title="다음 기사 (→)">다음 ›</button>';
    bar += '<span class="sp"></span>';
    bar += '<button class="ux-rbtn" onclick="uxCopyLink()" title="이 기사로 바로 오는 링크 복사">🔗 링크</button>';
    bar += '<button class="ux-rbtn" onclick="uxCloseReader()" title="닫기 (Esc)">✕</button>';
    document.getElementById('uxReaderBar').innerHTML = bar;

    var h = '';
    if (!isPlaceholder(p.image)) h += '<img src="' + e(p.image) + '" alt="" onerror="this.remove()">';
    h += '<div class="ux-r-meta"><span>' + e(srcName(p)) + '</span><span>' + fmtDate(rec.date) + ' 호</span>' + (p.domain ? '<span>' + e(domLabel(p.domain)) + '</span>' : '') + (p.category ? '<span>' + e(p.category) + '</span>' : '') + '</div>';
    h += '<h2 class="ux-r-title">' + e(p.title_ko || p.title) + '</h2>';
    if (p.creator_name) h += '<div class="ux-r-by">By ' + e(p.creator_name) + '</div>';
    var sum = p.content || p.summary;
    if (sum) h += '<div class="ux-r-sec"><h4>무슨 내용인가</h4><p>' + e(sum) + '</p></div>';
    if (p.why) h += '<div class="ux-r-sec ux-r-why"><h4>큐레이터의 관점</h4><p>' + e(p.why) + '</p></div>';
    if (p.creator_insight && p.creator_insight !== p.why) h += '<div class="ux-r-sec ux-r-quote"><h4>크리에이터 인사이트</h4><p>“' + e(p.creator_insight) + '”</p></div>';
    if (p.social_proof) h += '<div class="ux-r-sec"><h4>교차 신호</h4><p>🏆 ' + e(p.social_proof) + '</p></div>';
    var chips = [];
    (p.execution_techniques || []).forEach(function (t) { chips.push(String(t).replace(/^#+/, '')); });
    (p.tags || []).forEach(function (t) { chips.push(String(t).replace(/^#+/, '')); });
    if (chips.length) {
      h += '<div class="ux-r-sec"><h4>기법 · 태그 (누르면 아카이브 검색)</h4><div class="ux-r-chips">';
      chips.forEach(function (c) { var q = c.replace(/\s*\(.*$/, ''); h += '<button onclick="uxSearchFromReader(\'' + jsq(q) + '\')">#' + e(c) + '</button>'; });
      h += '</div></div>';
    }
    var saved = isSaved(p.url), note = notes()[p.url];
    h += '<div class="ux-r-actions">';
    h += '<a class="primary" href="' + e(p.url) + '" target="_blank" rel="noopener" onclick="uxMarkRead(\'' + id + '\')">원문 읽기 ↗</a>';
    h += '<button class="' + (saved ? 'saved' : '') + '" onclick="uxSave(event,\'' + id + '\')">' + (saved ? '♥ 저장됨' : '♡ 저장 + 한 줄 생각') + '</button>';
    h += '<button onclick="uxAskAbout(\'' + id + '\')">🧠 큐레이터에게 더 묻기</button>';
    h += '</div>';
    if (saved && note) h += '<div class="ux-r-note">💭 나의 통찰: ' + e(note) + '</div>';
    h += '<div class="ux-rel" id="uxRel"></div>';
    var nid = pos >= 0 ? listCtx[pos + 1] : null;
    if (nid && ITEMS[nid]) {
      h += '<button class="ux-next" onclick="uxReaderStep(1)"><small>다음 기사 · ' + (pos + 2) + ' / ' + listCtx.length + '</small><span>' + e(ITEMS[nid].item.title_ko || ITEMS[nid].item.title) + ' →</span></button>';
    } else if (state.v === 'day' && pos >= 0) {
      var older = MANIFEST_DATES[dateIdx(state.d) + 1];
      h += '<div class="ux-next end"><small>이 호의 마지막 기사예요</small>' + (older ? '<button onclick="uxCloseThen(\'' + older + '\')">이전 호 ' + fmtDate(older) + ' (' + wk(older) + ') 읽기 →</button>' : '') + '</div>';
    }
    h += '<div class="ux-kbd">← → 이전/다음 · Esc 닫기 · 링크를 공유하면 이 기사가 바로 열립니다</div>';
    var body = document.getElementById('uxReaderBody');
    body.innerHTML = h;
    body.scrollTop = 0;
    r.classList.add('open');
    document.documentElement.style.overflow = 'hidden';
    markRead(id);
    renderRelated(id);
  }
  function renderRelated(id) {
    var box = document.getElementById('uxRel'); if (!box) return;
    if (!allLoaded) {
      box.innerHTML = '<div class="ux-r-sec"><h4>연결된 이슈</h4><p style="font-size:13px;color:var(--dim)">전체 아카이브에서 찾는 중...</p></div>';
      loadAll().then(function () { if (state.a === id) renderRelated(id); });
      return;
    }
    var rel = related(id, 5);
    var h = '<div class="ux-r-sec"><h4>연결된 이슈 · 같은 기법/태그로 이어진 기사</h4>';
    if (!rel.length) h += '<p style="font-size:13px;color:var(--dim)">아직 같은 기법이나 태그로 이어진 기사가 없습니다.</p>';
    rel.forEach(function (x) {
      var o = ITEMS[x.id].item;
      h += '<button class="ux-rel-item" onclick="uxOpenRelated(\'' + x.id + '\')"><small>' + fmtDate(x.date) + ' · ' + e(srcName(o)) + '</small><span>' + e(o.title_ko || o.title) + '</span><em>' + e(x.why.slice(0, 3).join(' · ')) + '</em></button>';
    });
    h += '</div>';
    box.innerHTML = h;
  }
  window.uxOpenRelated = function (id) { listCtx = [id]; uxOpen(id, true); };
  window.uxReaderStep = function (delta) {
    var pos = listCtx.indexOf(state.a), nid = listCtx[pos + delta];
    if (pos < 0 || !nid) return;
    uxOpen(nid, true);
    var c = document.querySelector('#main .ux-card[data-id="' + nid + '"]');
    if (c) c.scrollIntoView({ block: 'center' });
  };
  window.uxMarkRead = function (id) { markRead(id); };
  window.uxCopyLink = function () {
    var url = location.origin + location.pathname + toHash(state);
    var done = function () { toast('이 기사로 바로 오는 링크를 복사했습니다'); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { prompt('링크 복사', url); });
    else prompt('링크 복사', url);
  };
  window.uxSearchFromReader = function (q) { readerPushed = false; state.a = ''; navigate({ v: 'search', q: q }); };
  window.uxAskAbout = function (id) {
    var p = ITEMS[id] && ITEMS[id].item; if (!p) return;
    var panel = document.getElementById('askCuratorPanel'), input = document.getElementById('askCuratorInput');
    if (!panel || !input) return;
    panel.classList.add('open');
    input.value = '“' + (p.title_ko || p.title) + '” 이 사례를 TVCF·브랜드 영상 연출에 적용한다면 구체적으로 어떤 장면/기법이 가능할까?';
    input.focus();
    toast('질문을 채워뒀어요. 다듬어서 전송하세요');
  };

  /* ---------------- save ---------------- */
  window.uxSave = function (ev, id) { var it = ITEMS[id]; if (it) window.toggleSave(ev, it.item.url); };
  window.toggleSave = function (ev, url) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    var idx = savedUrls.indexOf(url);
    if (idx === -1) {
      currentSocUrl = url;
      document.getElementById('socNote').value = notes()[url] || '';
      document.getElementById('socraticModal').style.display = 'flex';
      setTimeout(function () { document.getElementById('socNote').focus(); }, 50);
    } else {
      savedUrls.splice(idx, 1);
      localStorage.setItem('creative_archive', JSON.stringify(savedUrls));
      afterSaveChange();
      toast('아카이브에서 뺐습니다');
    }
  };
  window.saveSocraticNote = function () {
    var note = document.getElementById('socNote').value.trim();
    var all = notes(); all[currentSocUrl] = note; LS.set('creative_insights_notes', all);
    if (savedUrls.indexOf(currentSocUrl) === -1) { savedUrls.push(currentSocUrl); localStorage.setItem('creative_archive', JSON.stringify(savedUrls)); }
    closeSocraticModal();
    afterSaveChange();
    toast('MY ARCHIVE에 저장했습니다', '보러 가기', function () { setSpecialView('archive'); });
  };
  function afterSaveChange() {
    var btns = document.querySelectorAll('[data-save-id]');
    for (var i = 0; i < btns.length; i++) { var it = ITEMS[btns[i].getAttribute('data-save-id')]; if (it) btns[i].innerHTML = heartSVG(isSaved(it.item.url)); }
    if (state.v === 'archive') renderArchiveX();
    if (state.a) syncReader();
  }
  var toastTimer = null;
  function toast(msg, actLabel, act) {
    var t = document.getElementById('uxToast');
    if (!t) { t = document.createElement('div'); t.id = 'uxToast'; t.className = 'ux-toast'; document.body.appendChild(t); }
    t.innerHTML = '<span>' + e(msg) + '</span>' + (actLabel ? '<button>' + e(actLabel) + '</button>' : '');
    if (actLabel) t.querySelector('button').onclick = function () { t.classList.remove('show'); if (state.a) { state.a = ''; syncReader(); } act(); };
    t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  /* ---------------- archive ---------------- */
  function renderArchiveX() {
    var n = notes(), cards = [], missing = [];
    savedUrls.slice().reverse().forEach(function (url) {
      var id = hid(url);
      if (ITEMS[id]) cards.push(ITEMS[id]); else missing.push(url);
    });
    var scraped = LS.get('scraped_ai_articles', []);
    scraped.forEach(function (p) { if (!p || !p.url) return; var id = hid(p.url); if (!ITEMS[id]) { ITEMS[id] = { item: p, date: (p.scrapedAt || '').slice(0, 10) || latest(), id: id }; } if (cards.indexOf(ITEMS[id]) === -1) cards.push(ITEMS[id]); });
    listCtx = cards.map(function (c) { return c.id; });
    var noteN = cards.filter(function (c) { return n[c.item.url]; }).length;
    var h = '<div class="ux-sec-h"><h2>♥ MY ARCHIVE</h2><p>저장한 기사 <b>' + cards.length + '개</b> · 한 줄 생각 ' + noteN + '개. 최근 저장 순. 이 기기 브라우저에 저장되므로 다른 기기에서 보려면 ☁️ 동기화 코드를 쓰세요.</p>';
    if (scraped.length) h += '<p><button class="ux-more" style="display:inline-block;margin:14px 0 0;" onclick="exportScrapedData()">📥 딥서치 스크랩 데이터 다운로드</button></p>';
    h += '</div>';
    if (!cards.length) h += '<div class="ux-grid-empty">아직 저장한 기사가 없습니다.<br>카드의 ♥ 또는 기사 안의 “저장 + 한 줄 생각”을 눌러 영감을 모아보세요.</div>';
    else {
      h += '<div class="picks" style="margin-top:30px">';
      cards.forEach(function (c, i) { h += cardHTML(c.item, c.date, { i: i, showDate: true, note: n[c.item.url] }); });
      h += '</div>';
    }
    if (missing.length) h += '<div class="ux-grid-empty" style="padding-top:0">원본 데이터에서 찾을 수 없는 저장 링크 ' + missing.length + '개: ' + missing.map(function (u) { return '<a href="' + e(u) + '" target="_blank" rel="noopener" style="text-decoration:underline">' + e(u.replace(/^https?:\/\//, '').slice(0, 50)) + '</a>'; }).join(' · ') + '</div>';
    document.getElementById('main').innerHTML = h;
  }

  /* ---------------- popcorn ---------------- */
  function renderPopcornX() {
    var seenU = {}, seenT = {}, groups = [], total = 0;
    MANIFEST_DATES.forEach(function (d) {
      var entry = DAYS[d]; if (!entry) return;
      var raw = entry.popcorn && entry.popcorn.length ? entry.popcorn : dayItems(entry).filter(function (p) { return p.domain === 'POPCORN' || p.category === '바이럴' || (p.tags && p.tags.indexOf('바이럴') !== -1); });
      var items = raw.filter(function (it) {
        var u = (it.url || '').trim().toLowerCase(), t = (it.title_ko || it.title || '').trim().toLowerCase();
        if ((u && seenU[u]) || (t && seenT[t])) return false;
        if (u) seenU[u] = 1; if (t) seenT[t] = 1; return true;
      });
      if (items.length) { groups.push({ d: d, items: items }); total += items.length; }
    });
    var shown = groups.slice(0, popLimit);
    listCtx = [];
    var h = '<div class="ux-sec-h"><h2>🍿 POPCORN</h2><p>가볍게 훑는 화제성 이슈. 전체 ' + total + '개 중 최근 ' + shown.length + '개 호를 보여줍니다.</p></div>';
    if (!groups.length) h += '<div class="ux-grid-empty">아직 수집된 팝콘 뉴스가 없습니다.</div>';
    shown.forEach(function (g) {
      h += '<div class="ux-dayhead">' + fmtDate(g.d) + ' (' + wk(g.d) + ') <button onclick="uxGoDay(\'' + g.d + '\')">이 날 이슈 전체 보기</button></div><div class="picks">';
      g.items.forEach(function (p, i) { listCtx.push(hid(p.url)); h += cardHTML(p, g.d, { i: i }); });
      h += '</div>';
    });
    if (groups.length > popLimit) h += '<button class="ux-more" onclick="uxMorePop()">이전 7일 더 보기 (' + (groups.length - popLimit) + '개 호 남음)</button>';
    document.getElementById('main').innerHTML = h;
  }
  window.uxMorePop = function () { var y = window.scrollY; popLimit += 7; renderPopcornX(); window.scrollTo(0, y); };

  /* ---------------- creators ---------------- */
  function renderCreatorsX() {
    var shown = MANIFEST_DATES.filter(function (d) { return DAYS[d]; }).slice(0, creLimit);
    listCtx = [];
    var h = '<div style="max-width:900px; margin: 40px auto; padding: 0 20px; text-align:center;">';
    h += '<div class="ux-sec-h" style="padding:0;text-align:center"><h2>✨ CREATORS\' INSIGHT</h2><p>기사 속 창작자의 태도와 방법론만 모아 읽는 뷰. 카드를 누르면 전체 맥락이 열립니다.</p></div>';
    shown.forEach(function (d) {
      var entry = DAYS[d], picks = dayItems(entry);
      h += '<div style="margin: 50px 0 70px;"><div style="font-size:13px; font-weight:700; color:var(--acc); letter-spacing:3px; margin-bottom:25px;">' + fmtDate(d) + ' (' + wk(d) + ')</div>';
      if (entry.creator_message) h += '<div style="background:var(--card); border:1px solid var(--border); padding:34px 30px; margin-bottom:40px; border-radius:16px;"><div style="font-family:\'Noto Serif KR\',serif; font-size:18px; line-height:1.8; max-width:680px; margin:0 auto; word-break:keep-all; font-style:italic;">' + e(cleanQ(entry.creator_message)) + '</div></div>';
      h += '<div style="display:flex; flex-direction:column; gap:26px; align-items:center;">';
      picks.forEach(function (p) {
        var id = hid(p.url); listCtx.push(id);
        var name = (p.creator_name && p.creator_name.trim()) || srcName(p);
        var quote = p.creator_insight || p.why || '';
        h += '<a href="' + e(p.url) + '" target="_blank" rel="noopener" class="ux-creator" data-id="' + id + '" onclick="return uxCardClick(event,\'' + id + '\')" style="display:block; width:100%; max-width:720px; background:var(--card); border:1px solid var(--border); border-radius:16px; padding:32px 30px; text-align:center;' + (READ[id] ? ' opacity:.7;' : '') + '">';
        h += '<div style="font-family:\'Playfair Display\',serif; font-size:24px; font-weight:700; margin-bottom:10px;">' + e(name) + '</div>';
        if (quote) h += '<div style="font-family:\'Noto Serif KR\',serif; font-size:16px; line-height:1.8; color:var(--acc); margin:14px auto; max-width:620px; font-style:italic;">“ ' + e(quote) + ' ”</div>';
        h += '<div style="font-size:13px; font-weight:600; color:var(--sub); margin-top:12px;">' + e(p.title_ko || p.title) + '</div>';
        h += '<div style="font-size:11px; color:var(--dim); margin-top:10px; letter-spacing:1.5px; text-transform:uppercase;">' + e(domLabel(p.domain || '')) + ' · ' + e(srcName(p)) + '</div></a>';
      });
      h += '</div></div><hr style="border:0; border-top:1px dashed var(--border); margin:40px 0;">';
    });
    h += '</div>';
    var remain = MANIFEST_DATES.filter(function (d) { return DAYS[d]; }).length - shown.length;
    if (remain > 0) h += '<button class="ux-more" onclick="uxMoreCre()">이전 5일 더 보기 (' + remain + '개 호 남음)</button>';
    document.getElementById('main').innerHTML = h;
  }
  window.uxMoreCre = function () { var y = window.scrollY; creLimit += 5; renderCreatorsX(); window.scrollTo(0, y); };

  /* ---------------- weekly trend ---------------- */
  function renderTrendX() {
    var dates = MANIFEST_DATES.slice(0, 7).filter(function (d) { return DAYS[d]; });
    var tokDates = {}, groups = [];
    listCtx = [];
    dates.forEach(function (d) {
      var entry = DAYS[d], kws = entry.macro_keywords || [], items = dayItems(entry), cards = [], sc = makeScorer(items);
      kws.forEach(function (k) {
        kwTokens(k.word).forEach(function (t) { tokDates[t] = tokDates[t] || {}; tokDates[t][d] = 1; });
        var rel = items.map(function (p) { return { p: p, s: sc(k.word, p) }; }).filter(function (x) { return x.s > 0; })
          .sort(function (a, b) { return b.s - a.s; }).slice(0, 3);
        cards.push({ k: k, rel: rel });
      });
      if (cards.length) groups.push({ d: d, cards: cards });
    });
    var signals = Object.keys(tokDates).map(function (t) { return { t: t, n: Object.keys(tokDates[t]).length }; })
      .filter(function (x) { return x.n >= 2; })
      .map(function (x) {
        var hits = 0; Object.keys(ITEMS).forEach(function (id) { if (hayOf(ITEMS[id].item).indexOf(x.t) !== -1) hits++; });
        x.hits = hits; return x;
      })
      .filter(function (x) { return x.hits > 0 && x.hits / Math.max(1, Object.keys(ITEMS).length) <= 0.1; })
      .sort(function (a, b) { return b.n - a.n || b.hits - a.hits; }).slice(0, 10);
    var h = '<div class="ux-sec-h"><h2>📈 WEEKLY TREND</h2><p>최근 7개 호에서 큐레이터가 뽑은 키워드입니다. 각 키워드 아래에 <b>그 흐름과 실제로 연결된 기사</b>를 붙였고, 여러 날 반복된 단어는 “반복 신호”로 따로 모았습니다.</p></div>';
    if (signals.length) {
      h += '<div class="ux-dayhead">반복 신호 · 2개 호 이상 등장 (누르면 전체 아카이브 검색)</div><div class="ux-signals">';
      signals.forEach(function (x) { h += '<button class="ux-sig" onclick="searchArchiveKeyword(\'' + jsq(x.t) + '\')">' + e(x.t) + '<small>' + x.n + '개 호 · 기사 ' + x.hits + '</small></button>'; });
      h += '</div>';
    }
    if (!groups.length) h += '<div class="ux-grid-empty">최근 7일 키워드 데이터가 없습니다.</div>';
    groups.forEach(function (g) {
      h += '<div class="ux-dayhead">' + fmtDate(g.d) + ' (' + wk(g.d) + ') <button onclick="uxGoDay(\'' + g.d + '\')">이 날 이슈 보기</button></div><div class="ux-kwgrid">';
      g.cards.forEach(function (c) {
        h += '<div class="ux-kwcard' + (c.k.is_hot ? ' hot' : '') + '"><h3>#' + e(c.k.word) + (c.k.is_hot ? '<small>HOT</small>' : '') + '</h3>';
        if (!c.rel.length) h += '<div class="none">특정 기사보다 이 날 전체 흐름에서 도출된 키워드</div>';
        c.rel.forEach(function (x) {
          var id = hid(x.p.url); if (listCtx.indexOf(id) === -1) listCtx.push(id);
          h += '<button class="ux-rel-item" onclick="uxOpen(\'' + id + '\')"><small>' + e(srcName(x.p)) + '</small><span>' + e(x.p.title_ko || x.p.title) + '</span></button>';
        });
        h += '</div>';
      });
      h += '</div>';
    });
    document.getElementById('main').innerHTML = h;
  }
  window.renderWeeklyTrend = function () { renderState({ scroll: false }); };

  /* ---------------- search ---------------- */
  function renderSearchX(q) {
    var toks = q.toLowerCase().split(/\s+/).filter(Boolean), res = [], seen = {};
    MANIFEST_DATES.forEach(function (d) {
      var entry = DAYS[d]; if (!entry) return;
      dayItems(entry).concat(entry.popcorn || []).forEach(function (p) {
        if (!p || !p.url || seen[p.url]) return;
        var hay = hayOf(p);
        if (toks.every(function (t) { return hay.indexOf(t) !== -1; })) { seen[p.url] = 1; res.push({ p: p, d: d }); }
      });
    });
    if (searchFor !== q) { searchFor = q; searchCap = 60; }
    var cap = searchCap, shown = res.slice(0, cap);
    listCtx = shown.map(function (x) { return hid(x.p.url); });
    var h = '<div class="ux-sec-h"><h2 style="font-size:1.5rem">“' + e(q) + '” 검색 결과 ' + res.length + '건</h2>';
    h += '<p>제목 · 요약 · 큐레이터 관점 · 크리에이터 · 기법 · 태그를 모두 검색합니다. 최신순' + (res.length > cap ? ', ' + cap + '건씩 표시' : '') + '. ';
    h += '<button class="ux-kw" style="margin-left:6px" onclick="uxAskSearch()">🧠 이 주제로 큐레이터에게 묻기</button></p></div>';
    if (!res.length) h += '<div class="ux-grid-empty">일치하는 기사가 없습니다. 더 짧은 단어(예: “물성”, “타이포”, “캠페인”)로 검색하거나 큐레이터에게 물어보세요.</div>';
    else {
      h += '<div class="picks" style="margin-top:30px">';
      shown.forEach(function (x, i) { h += cardHTML(x.p, x.d, { i: i, showDate: true, hl: toks }); });
      h += '</div>';
      if (res.length > cap) h += '<button class="ux-more" onclick="uxMoreSearch()">더 보기 (' + (res.length - cap) + '건 남음)</button>';
    }
    document.getElementById('main').innerHTML = h;
  }
  var searchFor = '', searchCap = 60;
  window.uxMoreSearch = function () { var y = window.scrollY; searchCap += 60; renderSearchX(state.q); window.scrollTo(0, y); };
  window.renderSearch = function (kw) { renderSearchX(kw); };
  window.uxAskSearch = function () {
    var panel = document.getElementById('askCuratorPanel'), input = document.getElementById('askCuratorInput');
    if (!panel || !input) return;
    panel.classList.add('open');
    input.value = '“' + state.q + '” 관련해서 최근 아카이브에서 연출가가 꼭 봐야 할 흐름을 정리해줘';
    input.focus();
  };

  /* ---------------- ask curator: render **bold** safely ---------------- */
  window.sendToCurator = async function () {
    var input = document.getElementById('askCuratorInput'), q = input.value.trim();
    if (!q) return;
    input.value = '';
    document.getElementById('askCuratorSend').disabled = true;
    appendAskMessage('user', q);
    var el = appendAskMessage('agent', '생각 중...');
    try {
      var res = await fetch(ASK_CURATOR_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) });
      var data = await res.json();
      var text = data.answer || ('오류: ' + (data.error || '알 수 없는 오류'));
      el.querySelector('.bubble').innerHTML = e(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>') + answerLinks(text);
    } catch (x) {
      el.querySelector('.bubble').textContent = '연결에 실패했습니다. 잠시 후 다시 시도해주세요.';
    } finally {
      document.getElementById('askCuratorSend').disabled = false;
      var w = document.getElementById('askCuratorMessages'); w.scrollTop = w.scrollHeight;
    }
  };

  /* ---------------- keyboard & inputs ---------------- */
  document.addEventListener('keydown', function (ev) {
    var tag = (ev.target && ev.target.tagName) || '';
    var typing = /INPUT|TEXTAREA|SELECT/.test(tag);
    var soc = document.getElementById('socraticModal');
    if (soc && soc.style.display === 'flex') {
      if (ev.key === 'Escape') { closeSocraticModal(); ev.preventDefault(); }
      else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { saveSocraticNote(); ev.preventDefault(); }
      return;
    }
    if (ev.key === 'Escape') {
      if (state.a) { uxCloseReader(); ev.preventDefault(); return; }
      if (tag === 'INPUT' && ev.target.id === 'searchInput') { ev.target.value = ''; ev.target.blur(); if (state.v === 'search') uxGoDay(lastDay || latest()); return; }
    }
    if (typing) return;
    if (state.a && ev.key === 'ArrowLeft') { uxReaderStep(-1); ev.preventDefault(); }
    else if (state.a && ev.key === 'ArrowRight') { uxReaderStep(1); ev.preventDefault(); }
    else if (ev.key === '/' && !state.a) { var si = document.getElementById('searchInput'); if (si) { si.focus(); ev.preventDefault(); } }
  });

  function wireStatic() {
    var soc = document.getElementById('socraticModal');
    if (soc) {
      soc.addEventListener('click', function (ev) { if (ev.target === soc) closeSocraticModal(); });
      var h3 = document.getElementById('socTitle');
      if (h3 && !document.getElementById('uxSocHint')) h3.insertAdjacentHTML('afterend', '<div id="uxSocHint" style="font-size:12px;color:var(--dim);margin:-10px 0 16px;">비워두고 저장해도 됩니다 · ⌘/Ctrl+Enter 저장 · Esc 취소</div>');
    }
    var si = document.getElementById('searchInput');
    if (si) {
      var fresh = si.cloneNode(true);
      si.parentNode.replaceChild(fresh, si);
      fresh.placeholder = '아카이브 검색 (예: 타이포, 캠페인, 물성)  /';
      var tmr = null;
      fresh.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { clearTimeout(tmr); var v = fresh.value.trim(); if (v) searchArchiveKeyword(v); else uxGoDay(lastDay || latest()); }
      });
      fresh.addEventListener('input', function () {
        clearTimeout(tmr);
        var v = fresh.value.trim();
        if (v.length < 2) return;
        tmr = setTimeout(function () { searchArchiveKeyword(v); }, 450);
      });
    }
    var hr = document.querySelector('.hdr-r');
    if (hr) {
      var g = hr.querySelector('a[href="graph.html"]'), c = hr.querySelector('button[onclick="openSyncModal()"]');
      if (g && !g.querySelector('.ux-hlabel')) g.insertAdjacentHTML('beforeend', '<span class="ux-hlabel">지식망</span>');
      if (c && !c.querySelector('.ux-hlabel')) c.insertAdjacentHTML('beforeend', '<span class="ux-hlabel">동기화</span>');
    }
    var brand = document.querySelector('.brand');
    if (brand) brand.setAttribute('onclick', 'uxGoDay(MANIFEST_DATES[0])');
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    wireStatic();
    try {
      var res = await fetch('data/manifest.json?' + Date.now(), { cache: 'no-store' });
      var manifest = await res.json();
      MANIFEST_DATES = manifest.dates || [];
      DATA.latest_date = MANIFEST_DATES[0] || '';
    } catch (err) {
      console.error('manifest', err);
      document.getElementById('main').innerHTML = loadingHTML('시스템 로딩에 실패했습니다. (Manifest Error)');
      return;
    }
    try { history.scrollRestoration = 'manual'; } catch (x) {}
    prevSeen = LS.get('ci_seen_latest', null);
    firstVisit = !prevSeen;
    if (prevSeen) newDates = MANIFEST_DATES.filter(function (d) { return d > prevSeen; });
    LS.set('ci_seen_latest', latest());
    state = parseHash();
    lastDay = state.v === 'day' ? state.d : latest();
    history.replaceState(null, '', toHash(state));
    await renderState({ scroll: false });
    var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1500); };
    idle(function () { loadAll(); });
  }
  /* link article titles the curator mentions in its answer */
  function answerLinks(text) {
    var cands = [], m, re = /['‘“"「『]([^'’”"」』]{2,40})['’”"」』]/g;
    while ((m = re.exec(text))) cands.push(m[1].trim());
    var bre = /\*\*(.+?)\*\*/g; while ((m = bre.exec(text))) cands.push(m[1].replace(/['‘’“”"]/g, '').replace(/\s*(기사|캠페인|사례)$/, '').trim());
    var found = [], seen = {};
    var keys = Object.keys(ITEMS).sort(function (a, b) { return ITEMS[a].date < ITEMS[b].date ? 1 : -1; });
    cands.forEach(function (c) {
      if (c.length < 3 || found.length >= 3) return;
      var cl = c.toLowerCase();
      for (var i = 0; i < keys.length; i++) {
        var it = ITEMS[keys[i]].item, t = String(it.title_ko || it.title || '').toLowerCase();
        if (t.indexOf(cl) !== -1 || (cl.length >= 8 && cl.indexOf(t.slice(0, 12)) !== -1)) { if (!seen[keys[i]]) { seen[keys[i]] = 1; found.push(keys[i]); } break; }
      }
    });
    if (!found.length) return '';
    return '<div class="ux-ans-links">' + found.map(function (k) { return '<button onclick="uxOpenFromAsk(\'' + k + '\')">📄 ' + e(ITEMS[k].item.title_ko || ITEMS[k].item.title) + '</button>'; }).join('') + '</div>';
  }
  window.uxOpenFromAsk = function (id) { listCtx = [id]; if (state.a) uxOpen(id, true); else uxOpen(id); };
  function flashCard(id) {
    var c = document.querySelector('#main .ux-card[data-id="' + id + '"], #main .ux-creator[data-id="' + id + '"]');
    if (!c) return;
    var r = c.getBoundingClientRect();
    if (r.top < 60 || r.bottom > window.innerHeight) c.scrollIntoView({ block: 'center' });
    c.classList.add('ux-flash');
    setTimeout(function () { c.classList.remove('ux-flash'); }, 1600);
  }
  window.uxResume = function () {
    var ids = dayItems(DAYS[state.d] || {}).map(function (p) { return hid(p.url); });
    listCtx = listCtx.length ? listCtx : ids;
    var target = listCtx.filter(function (id) { return !READ[id]; })[0] || listCtx[0];
    if (target) openReader(target);
  };
  window.uxToggleUnread = function () { unreadOnly = !unreadOnly; LS.set('ci_unread_only', unreadOnly); renderState({ scroll: false }); };
  window.uxCloseThen = function (d) { readerPushed = false; state.a = ''; lastOpen = ''; syncReader(); uxGoDay(d); };

  /* sync code v2: saves + notes + read marks (legacy codes still import) */
  window.exportSyncCode = function () {
    var payload = { v: 2, a: savedUrls, n: notes(), r: READ };
    var code = (window.LZString ? 'CI2:' + LZString.compressToEncodedURIComponent(JSON.stringify(payload)) : btoa(JSON.stringify(savedUrls)));
    document.getElementById('syncCodeInput').value = code;
    document.getElementById('syncMsg').innerText = '저장 ' + savedUrls.length + '개 · 메모 ' + Object.keys(notes()).length + '개 · 읽음 표시 ' + Object.keys(READ).length + '개를 담은 코드입니다. 다른 기기에 붙여넣으세요.';
  };
  window.importSyncCode = function () {
    var code = document.getElementById('syncCodeInput').value.trim(), msg = document.getElementById('syncMsg');
    if (!code) { msg.innerText = '코드를 입력해주세요.'; return; }
    try {
      var a, n = {}, r = {};
      if (code.indexOf('CI2:') === 0) { var p = JSON.parse(LZString.decompressFromEncodedURIComponent(code.slice(4))); a = p.a; n = p.n || {}; r = p.r || {}; }
      else a = JSON.parse(atob(code));
      if (!Array.isArray(a)) throw new Error('bad');
      var merged = savedUrls.slice(); a.forEach(function (u) { if (merged.indexOf(u) === -1) merged.push(u); });
      localStorage.setItem('creative_archive', JSON.stringify(merged));
      var nn = notes(); Object.keys(n).forEach(function (k) { if (n[k] || !nn[k]) nn[k] = n[k]; }); LS.set('creative_insights_notes', nn);
      Object.keys(r).forEach(function (k) { if (!READ[k]) READ[k] = r[k]; }); LS.set('ci_read', READ);
      msg.innerText = '동기화 완료 (기존 기록과 합침). 새로고침합니다.';
      setTimeout(function () { location.reload(); }, 1200);
    } catch (x) { msg.innerText = '유효하지 않은 코드입니다.'; }
  };

  window.uxDebug = function () { return { state: state, days: Object.keys(DAYS).length, items: Object.keys(ITEMS).length, allLoaded: allLoaded, newDates: newDates, listCtx: listCtx.length }; };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
