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
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="' + (on ? 'var(--ux-acc)' : 'none') + '" stroke="' + (on ? 'var(--ux-acc)' : 'currentColor') + '" stroke-width="1.6"><path d="M12 20.5l-1.3-1.2C5.6 14.7 2.5 11.9 2.5 8.4 2.5 5.6 4.7 3.5 7.4 3.5c1.6 0 3.2.8 4.6 2.1 1.4-1.3 3-2.1 4.6-2.1 2.7 0 4.9 2.1 4.9 4.9 0 3.5-3.1 6.3-8.2 10.9L12 20.5z"/></svg>';
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
    var views = [['day', 'Issue'], ['creators', 'Creators'], ['popcorn', 'Popcorn'], ['trend', 'Trend'], ['archive', 'Archive'], ['agentlog', 'Log']];
    var h = '<div class="ux-views">';
    views.forEach(function (v) {
      var act = v[0] === 'day' ? 'uxGoDay(\'' + d + '\')' : 'setSpecialView(\'' + v[0] + '\')';
      h += '<button class="ux-v' + (s.v === v[0] ? ' on' : '') + '" onclick="' + act + '">' + v[1] + '</button>';
    });
    h += '</div><div class="ux-datepick">';
    h += '<button class="ux-arrow" ' + (i >= MANIFEST_DATES.length - 1 ? 'disabled' : '') + ' onclick="uxStep(1)" title="이전 호" aria-label="이전 호">‹</button>';
    h += '<select class="' + (s.v === 'day' ? 'is-on' : '') + '" onchange="uxGoDay(this.value)" aria-label="발행일 선택">';
    var curMonth = '';
    MANIFEST_DATES.forEach(function (ds) {
      var m = ds.slice(0, 7);
      if (m !== curMonth) { if (curMonth) h += '</optgroup>'; curMonth = m; h += '<optgroup label="' + m.slice(0, 4) + '년 ' + parseInt(m.slice(5), 10) + '월">'; }
      var isNew = newDates.indexOf(ds) !== -1;
      h += '<option value="' + ds + '"' + (ds === d ? ' selected' : '') + '>' + fmtDate(ds) + ' ' + wk(ds) + (isNew ? ' · new' : '') + '</option>';
    });
    if (curMonth) h += '</optgroup>';
    h += '</select>';
    h += '<button class="ux-arrow" ' + (i <= 0 ? 'disabled' : '') + ' onclick="uxStep(-1)" title="다음 호" aria-label="다음 호">›</button>';
    if (i > 0) h += '<button class="ux-today" onclick="uxGoDay(\'' + latest() + '\')">최신호</button>';
    else if (newDates.length && s.v === 'day') h += '<span class="ux-newdot">new ' + newDates.length + '</span>';
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
    var h = '<button class="ttab ' + (state.f === 'ALL' ? 'on' : '') + '" onclick="setDom(\'ALL\')">All ' + items.length + '</button>';
    Object.keys(counts).sort().forEach(function (k) {
      h += '<button class="ttab ' + (state.f === k ? 'on' : '') + '" onclick="setDom(\'' + jsq(k) + '\')">' + e(domLabel(k)) + ' ' + counts[k] + '</button>';
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
        window.renderDomainTabs();
        renderDay(entry);
        document.title = 'CREATIVE INSIGHT · ' + fmtDate(s.d);
      });
    } else {
      document.getElementById('threadTabs').innerHTML = '';
      var titles = { creators: "Creators' Insight", popcorn: 'Popcorn', trend: 'Weekly Trend', archive: 'My Archive', agentlog: 'Agent Log', search: '검색: ' + s.q };
      document.title = 'CREATIVE INSIGHT · ' + titles[s.v];
      if (s.v === 'agentlog') {
        p = Promise.resolve(ORIG.renderAgentLog && ORIG.renderAgentLog()).then(function () {
          var box = document.querySelector('#main > div'); if (!box) return;
          box.classList.add('ux-legacy');
          var h2 = box.querySelector('h2'); if (h2) h2.textContent = 'Agent Log';
        });
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
    var id = hid(p.url), read = !!READ[id], saved = isSaved(p.url);
    var h = '<a href="' + e(p.url) + '" target="_blank" rel="noopener" class="pick ux-card' + (read ? ' is-read' : '') + '" data-id="' + id + '" style="animation-delay:' + Math.min((opts.i || 0) * 0.04, 0.4).toFixed(2) + 's" onclick="return uxCardClick(event,\'' + id + '\')">';
    if (!isPlaceholder(p.image)) h += '<div class="pick-img-wrap"><img loading="lazy" src="' + e(p.image) + '" alt="" onerror="var w=this.parentElement;w.classList.add(\'ux-noimg\');w.innerHTML=\'<span>' + e(jsq(srcName(p))) + '</span>\'"></div>';
    else h += '<div class="pick-img-wrap ux-noimg"><span>' + e(srcName(p)) + '</span></div>';
    h += '<div class="pick-meta"><span class="pick-src">' + e(srcName(p)) + '</span>';
    var dom = p.domain || p.thread;
    if (dom) h += '<span class="ux-dom">' + e(domLabel(dom)) + '</span>';
    if (opts.showDate) h += '<span class="pick-date">' + short(date) + '</span>';
    if (read) h += '<span class="ux-read">읽음</span>';
    h += '<button class="ux-save' + (saved ? ' is-on' : '') + '" data-save-id="' + id + '" onclick="uxSave(event,\'' + id + '\')" title="저장" aria-label="저장">' + heartSVG(saved) + '</button></div>';
    h += '<div class="pick-ko">' + hlText(p.title_ko || p.title, opts.hl) + '</div>';
    var line = p.why || p.content || p.summary;
    if (line) h += '<div class="pick-why">' + hlText(line, opts.hl) + '</div>';
    if (opts.note) h += '<div class="ux-mynote">— ' + e(opts.note) + '</div>';
    h += '</a>';
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
        var m = c[i].querySelector('.pick-meta .ux-save');
        if (m && !c[i].querySelector('.ux-read')) m.insertAdjacentHTML('beforebegin', '<span class="ux-read">읽음</span>');
      }
    }
    updateProgress();
  }
  function updateProgress() {
    var el = document.getElementById('uxProgress'); if (!el || !DAYS[state.d]) return;
    var items = dayItems(DAYS[state.d]), n = items.filter(function (p) { return READ[hid(p.url)]; }).length;
    el.innerHTML = '<i><u style="width:' + Math.round(100 * n / Math.max(1, items.length)) + '%"></u></i>' + n + ' / ' + items.length + ' 읽음';
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
      h += '<div class="ux-onboard" id="uxOnboard"><span>카드를 누르면 요약과 큐레이터 관점이 먼저 열리고, 원문은 그 안에서 엽니다. 키워드를 누르면 관련 카드만 남습니다.</span><button onclick="uxDismissOnboard()">알겠어요</button></div>';
    }
    if (newDates.length && d === latest()) {
      h += '<div class="ux-since"><span>지난 방문 이후 <b>' + newDates.length + '개 호</b>가 새로 나왔어요</span>';
      newDates.slice(1, 6).forEach(function (nd) { h += '<button onclick="uxGoDay(\'' + nd + '\')">' + short(nd) + ' ' + wk(nd) + '</button>'; });
      h += '</div>';
    }
    h += '<section class="ux-brief">';
    h += '<div class="ux-brief-top"><span><b>' + fmtDate(d) + '</b> ' + wk(d) + '요일 · ' + items.length + '개</span><span class="ux-progress" id="uxProgress"></span>';
    if (readN < items.length) h += '<button class="ux-link" onclick="uxResume()">' + (readN ? '이어 읽기' : '처음부터 읽기') + '</button>';
    else h += '<span class="ux-done">다 읽었어요</span>';
    if (readN) h += '<button class="ux-link muted' + (unreadOnly ? ' on' : '') + '" onclick="uxToggleUnread()">' + (unreadOnly ? '전체 보기' : '안 읽은 것만') + '</button>';
    h += '</div>';
    if (entry.focusQ) h += '<p class="ux-brief-note" onclick="this.classList.toggle(\'open\')">' + e(cleanQ(entry.focusQ)) + '</p>';
    var kws = entry.macro_keywords || [];
    if (kws.length) {
      h += '<div class="ux-brief-kw">';
      kws.forEach(function (k) {
        var n = items.filter(function (p) { return kwScore(k.word, p) > 0; }).length;
        h += '<button class="ux-kw' + (k.is_hot ? ' hot' : '') + '" data-kw="' + e(k.word) + '" onclick="uxKw(this)">' + e(k.word) + (n ? '<small>' + n + '</small>' : '') + '</button>';
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
    h += older ? '<button onclick="uxGoDay(\'' + older + '\')">이전 호<b>← ' + fmtDate(older) + '</b></button>' : '<span></span>';
    h += newer ? '<button onclick="uxGoDay(\'' + newer + '\')">다음 호<b>' + fmtDate(newer) + ' →</b></button>' : '<span></span>';
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
    if (hint) hint.innerHTML = n ? '관련 카드 ' + n + '개 · 다시 누르면 해제' : '특정 카드보다 이 호 전체에서 읽힌 흐름입니다';
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
    bar += '<button class="ux-rbtn" ' + (pos > 0 ? '' : 'disabled') + ' onclick="uxReaderStep(-1)" title="이전 기사 (←)">← 이전</button>';
    bar += '<span class="pos">' + (pos >= 0 ? (pos + 1) + ' / ' + listCtx.length : '') + '</span>';
    bar += '<button class="ux-rbtn" ' + (pos >= 0 && pos < listCtx.length - 1 ? '' : 'disabled') + ' onclick="uxReaderStep(1)" title="다음 기사 (→)">다음 →</button>';
    bar += '<span class="sp"></span>';
    bar += '<button class="ux-rbtn" onclick="uxCopyLink()" title="이 기사로 바로 오는 링크 복사">링크 복사</button>';
    bar += '<button class="ux-rbtn" onclick="uxCloseReader()" title="닫기 (Esc)">닫기</button>';
    document.getElementById('uxReaderBar').innerHTML = bar;

    var h = '';
    if (!isPlaceholder(p.image)) h += '<img src="' + e(p.image) + '" alt="" onerror="this.remove()">';
    h += '<div class="ux-r-meta"><span>' + e(srcName(p)) + '</span><span>' + fmtDate(rec.date) + '</span>' + (p.domain ? '<span>' + e(domLabel(p.domain)) + '</span>' : '') + (p.category ? '<span>' + e(p.category) + '</span>' : '') + '</div>';
    h += '<h2 class="ux-r-title">' + e(p.title_ko || p.title) + '</h2>';
    if (p.creator_name) h += '<div class="ux-r-by">' + e(p.creator_name) + '</div>';
    var sum = p.content || p.summary;
    if (sum) h += '<div class="ux-r-sec"><h4>요약</h4><p>' + e(sum) + '</p></div>';
    if (p.why) h += '<div class="ux-r-sec ux-r-why"><h4>큐레이터의 관점</h4><p>' + e(p.why) + '</p></div>';
    if (p.creator_insight && p.creator_insight !== p.why) h += '<div class="ux-r-sec ux-r-quote"><h4>크리에이터 인사이트</h4><p>“' + e(p.creator_insight) + '”</p></div>';
    if (p.social_proof) h += '<div class="ux-r-sec"><h4>교차 보도</h4><p>' + e(p.social_proof) + '</p></div>';
    var chips = [];
    (p.execution_techniques || []).forEach(function (t) { chips.push(String(t).replace(/^#+/, '')); });
    (p.tags || []).forEach(function (t) { chips.push(String(t).replace(/^#+/, '')); });
    if (chips.length) {
      h += '<div class="ux-r-sec"><h4>기법 · 태그</h4><div class="ux-r-chips">';
      chips.forEach(function (c) { var q = c.replace(/\s*\(.*$/, ''); h += '<button onclick="uxSearchFromReader(\'' + jsq(q) + '\')">' + e(c) + '</button>'; });
      h += '</div></div>';
    }
    var saved = isSaved(p.url), note = notes()[p.url];
    h += '<div class="ux-r-actions">';
    h += '<a class="primary" href="' + e(p.url) + '" target="_blank" rel="noopener" onclick="uxMarkRead(\'' + id + '\')">원문 읽기 ↗</a>';
    h += '<button class="' + (saved ? 'saved' : '') + '" onclick="uxSave(event,\'' + id + '\')">' + (saved ? '저장됨' : '저장') + '</button>';
    h += '<button onclick="uxAskAbout(\'' + id + '\')">큐레이터에게 묻기</button>';
    h += '</div>';
    if (saved && note) h += '<div class="ux-r-note">' + e(note) + '</div>';
    h += '<div class="ux-rel" id="uxRel"></div>';
    var nid = pos >= 0 ? listCtx[pos + 1] : null;
    if (nid && ITEMS[nid]) {
      h += '<button class="ux-next" onclick="uxReaderStep(1)"><small>다음 · ' + (pos + 2) + ' / ' + listCtx.length + '</small><span>' + e(ITEMS[nid].item.title_ko || ITEMS[nid].item.title) + '</span></button>';
    } else if (state.v === 'day' && pos >= 0) {
      var older = MANIFEST_DATES[dateIdx(state.d) + 1];
      h += '<div class="ux-next end"><small>이 호의 마지막 기사</small>' + (older ? '<button onclick="uxCloseThen(\'' + older + '\')">' + fmtDate(older) + ' 호로 →</button>' : '') + '</div>';
    }
    h += '<div class="ux-kbd">← → 이동 · Esc 닫기</div>';
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
      box.innerHTML = '<div class="ux-r-sec"><h4>이어서 볼 기사</h4><p style="font-size:13px;color:var(--dim)">찾는 중...</p></div>';
      loadAll().then(function () { if (state.a === id) renderRelated(id); });
      return;
    }
    var rel = related(id, 5);
    var h = '<div class="ux-r-sec"><h4>이어서 볼 기사</h4>';
    if (!rel.length) h += '<p style="font-size:13px;color:var(--dim)">아직 이어지는 기사가 없습니다.</p>';
    rel.forEach(function (x) {
      var o = ITEMS[x.id].item;
      h += '<button class="ux-rel-item" onclick="uxOpenRelated(\'' + x.id + '\')"><small>' + fmtDate(x.date) + ' · ' + e(srcName(o)) + ' · ' + e(x.why.slice(0, 2).join(', ').replace(/#/g, '')) + '</small><span>' + e(o.title_ko || o.title) + '</span><em>' + e(x.why.slice(0, 3).join(' · ')) + '</em></button>';
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
    toast('저장했습니다', 'Archive 보기', function () { setSpecialView('archive'); });
  };
  function afterSaveChange() {
    var btns = document.querySelectorAll('[data-save-id]');
    for (var i = 0; i < btns.length; i++) { var it = ITEMS[btns[i].getAttribute('data-save-id')]; if (it) { var on = isSaved(it.item.url); btns[i].innerHTML = heartSVG(on); btns[i].classList.toggle('is-on', on); } }
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
    var h = '<div class="ux-sec-h"><h2>Archive</h2><p>저장 ' + cards.length + ' · 메모 ' + noteN + ' · 최근 저장 순. 이 브라우저에 보관되며, 다른 기기로는 Sync로 옮길 수 있어요.</p>';
    if (scraped.length) h += '<p><button class="ux-link" onclick="exportScrapedData()">딥서치 스크랩 내려받기</button></p>';
    h += '</div>';
    if (!cards.length) h += '<div class="ux-grid-empty">아직 저장한 기사가 없습니다. 카드의 하트나 기사 안의 “저장”으로 모아보세요.</div>';
    else {
      h += '<div class="picks">';
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
    var h = '<div class="ux-sec-h"><h2>Popcorn</h2><p>가볍게 훑는 화제성 이슈 · 전체 ' + total + '개</p></div>';
    if (!groups.length) h += '<div class="ux-grid-empty">아직 수집된 팝콘 뉴스가 없습니다.</div>';
    shown.forEach(function (g) {
      h += '<div class="ux-dayhead"><b>' + fmtDate(g.d) + '</b> ' + wk(g.d) + ' <button onclick="uxGoDay(\'' + g.d + '\')">이 호 보기</button></div><div class="picks">';
      g.items.forEach(function (p, i) { listCtx.push(hid(p.url)); h += cardHTML(p, g.d, { i: i }); });
      h += '</div>';
    });
    if (groups.length > popLimit) h += '<button class="ux-more" onclick="uxMorePop()">이전 7일 더 보기</button>';
    document.getElementById('main').innerHTML = h;
  }
  window.uxMorePop = function () { var y = window.scrollY; popLimit += 7; renderPopcornX(); window.scrollTo(0, y); };

  /* ---------------- creators ---------------- */
  function renderCreatorsX() {
    var all = MANIFEST_DATES.filter(function (d) { return DAYS[d]; }), shown = all.slice(0, creLimit);
    listCtx = [];
    var h = '<div class="ux-sec-h"><h2>Creators</h2><p>기사 속 창작자의 태도와 방법론만 모아 읽는 뷰입니다.</p></div>';
    shown.forEach(function (d) {
      var entry = DAYS[d], picks = dayItems(entry);
      h += '<div class="ux-dayhead"><b>' + fmtDate(d) + '</b> ' + wk(d) + '</div><div class="ux-clist">';
      if (entry.creator_message) h += '<p class="ux-cmsg">' + e(cleanQ(entry.creator_message)) + '</p>';
      picks.forEach(function (p) {
        var id = hid(p.url); listCtx.push(id);
        var name = (p.creator_name && p.creator_name.trim()) || srcName(p);
        var quote = p.creator_insight || p.why || '';
        h += '<a href="' + e(p.url) + '" target="_blank" rel="noopener" class="ux-citem ux-creator' + (READ[id] ? ' is-read' : '') + '" data-id="' + id + '" onclick="return uxCardClick(event,\'' + id + '\')">';
        h += '<div class="n">' + e(name) + '</div>';
        if (quote) h += '<div class="q">' + e(quote) + '</div>';
        h += '<div class="t">' + e(p.title_ko || p.title) + ' · ' + e(srcName(p)) + '</div></a>';
      });
      h += '</div>';
    });
    if (all.length > shown.length) h += '<button class="ux-more" onclick="uxMoreCre()">이전 5일 더 보기</button>';
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
    var h = '<div class="ux-sec-h"><h2>Trend</h2><p>최근 7개 호의 키워드와, 그 키워드로 이어지는 기사입니다.</p></div>';
    if (signals.length) {
      h += '<div class="ux-dayhead"><b>반복 신호</b> 2개 호 이상 등장</div><div class="ux-signals">';
      signals.forEach(function (x) { h += '<button class="ux-sig" onclick="searchArchiveKeyword(\'' + jsq(x.t) + '\')">' + e(x.t) + '<small>' + x.n + '호 · ' + x.hits + '</small></button>'; });
      h += '</div>';
    }
    if (!groups.length) h += '<div class="ux-grid-empty">최근 7일 키워드 데이터가 없습니다.</div>';
    groups.forEach(function (g) {
      h += '<div class="ux-dayhead"><b>' + fmtDate(g.d) + '</b> ' + wk(g.d) + ' <button onclick="uxGoDay(\'' + g.d + '\')">이 호 보기</button></div><div class="ux-kwgrid">';
      g.cards.forEach(function (c) {
        h += '<div class="ux-kwcard' + (c.k.is_hot ? ' hot' : '') + '"><h3>' + e(c.k.word) + (c.k.is_hot ? '<small>hot</small>' : '') + '</h3>';
        if (!c.rel.length) h += '<div class="none">이 호 전체에서 읽힌 흐름</div>';
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
    var h = '<div class="ux-sec-h"><h2>“' + e(q) + '” ' + res.length + '건</h2>';
    h += '<p>최신순 · <button class="ux-link" onclick="uxAskSearch()">이 주제로 큐레이터에게 묻기</button></p></div>';
    if (!res.length) h += '<div class="ux-grid-empty">일치하는 기사가 없습니다. 더 짧은 단어로 찾아보세요.</div>';
    else {
      h += '<div class="picks">';
      shown.forEach(function (x, i) { h += cardHTML(x.p, x.d, { i: i, showDate: true, hl: toks }); });
      h += '</div>';
      if (res.length > cap) h += '<button class="ux-more" onclick="uxMoreSearch()">더 보기</button>';
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
      fresh.placeholder = 'Search';
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
      if (g) g.textContent = 'Graph';
      if (c) c.textContent = 'Sync';
    }
    var ab = document.getElementById('askCuratorBtn'); if (ab) ab.textContent = 'Ask';
    var ah = document.querySelector('#askCuratorHeader span'); if (ah) ah.textContent = 'Ask the curator';
    var sh = document.getElementById('uxSocHint'); if (sh) sh.textContent = '비워둬도 저장됩니다 · ⌘/Ctrl+Enter 저장 · Esc 취소';
    var sm = document.querySelector('#syncModal h2'); if (sm) sm.textContent = 'Sync';
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
    return '<div class="ux-ans-links">' + found.map(function (k) { return '<button onclick="uxOpenFromAsk(\'' + k + '\')">→ ' + e(ITEMS[k].item.title_ko || ITEMS[k].item.title) + '</button>'; }).join('') + '</div>';
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
