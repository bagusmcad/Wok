// Token Radar radar-4: dark, dense. Reads window.RADAR and renders the board
// with a KPI strip, a reconciliation bar, slice cards that re-slice the whole
// board, a verdict per row, and the out-of-sample check in a right rail.
// No network: every byte shown is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, slice: null };
  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtSigned(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function median(values) {
    if (!values.length) return 0;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  // The model, recomputed in the page and checked against board.json.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? (DATA.median_age_days === null || DATA.median_age_days === undefined ? model.unknown_age_days : DATA.median_age_days) : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var multiple = row.category_multiple === undefined ? model.base_multiple : row.category_multiple;
    var chainFactor = row.chain_factor === undefined ? 1 : row.chain_factor;
    return Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturity * chainFactor));
  }
  function riskOf(row) { return row.risk || { score: 0, band: 'low', reasons: [] }; }
  function planOf(row) { return row.farmPlan || null; }
  function verdictOf(row) { return row.verdict || 'SKIP'; }
  function netOf(row) { return row.net_usd === undefined ? null : row.net_usd; }
  function scopeOf(r) { return r.scope || (r.tvl_usd >= DATA.floor_usd ? 'watchlist' : 'early'); }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'risk') { av = a.risk ? a.risk.score : 0; bv = b.risk ? b.risk.score : 0; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'net') { av = netOf(a) === null ? -Infinity : netOf(a); bv = netOf(b) === null ? -Infinity : netOf(b); }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  // A slice card re-slices the whole board: it becomes the category or chain
  // filter (the other clears), the KPI strip recomputes, and clicking the
  // same card again clears it.
  function applySlice(kind, value) {
    if (state.slice && state.slice.kind === kind && state.slice.value === value) {
      state.slice = null; state.category = 'all'; state.chain = 'all';
    } else {
      state.slice = { kind: kind, value: value };
      if (kind === 'category') { state.category = value; state.chain = 'all'; }
      else { state.chain = value; state.category = 'all'; }
    }
    writeHash(); render();
  }
  function clearSlice() { state.slice = null; state.category = 'all'; state.chain = 'all'; writeHash(); render(); }

  // Per-chain and per-category aggregates, computed live from the board rows.
  function sliceCards() {
    var chains = {}, cats = {};
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) {
        var a = chains[c] || (chains[c] = { kind: 'chain', value: c, n: 0, total: 0, mults: [], top: null });
        a.n++; a.total += r.implied_value_usd; a.mults.push(r.category_multiple);
        if (!a.top || r.implied_value_usd > a.top.implied_value_usd) a.top = r;
      });
      var key = r.category || 'Other';
      var b = cats[key] || (cats[key] = { kind: 'category', value: key, n: 0, total: 0, mults: [], top: null });
      b.n++; b.total += r.implied_value_usd; b.mults.push(r.category_multiple);
      if (!b.top || r.implied_value_usd > b.top.implied_value_usd) b.top = r;
    });
    function top6(map) {
      return Object.keys(map).map(function (k) { return map[k]; })
        .sort(function (a, b) { return b.n - a.n || b.total - a.total; }).slice(0, 6);
    }
    return { chains: top6(chains), categories: top6(cats) };
  }

  function kpiNumbers(list) {
    var total = 0, farm = 0, marginal = 0, skip = 0, top = null;
    list.forEach(function (r) {
      total += r.implied_value_usd;
      var v = verdictOf(r);
      if (v === 'FARM') farm++;
      else if (v === 'MARGINAL') marginal++;
      else skip++;
      if (!top || r.implied_value_usd > top.implied_value_usd) top = r;
    });
    return { ranked: list.length, total: total, farm: farm, marginal: marginal, skip: skip, top: top };
  }
  // Backtest numbers for the current slice: the held-out cases in the slice,
  // when there are ten or more; otherwise the global numbers, marked global.
  function sliceBacktest() {
    var bt = DATA.backtest || { n: 0, within_2x: 0, median_error_multiple: 0, range_holds: 0, cases: [] };
    if (!state.slice) return { miss: bt.median_error_multiple, holds: bt.range_holds, within: bt.within_2x, n: bt.n, sliced: false };
    var cases = (bt.cases || []).filter(function (c) {
      return state.slice.kind === 'category' ? c.category === state.slice.value : (c.chains || []).indexOf(state.slice.value) >= 0;
    });
    if (cases.length < 10) return { miss: bt.median_error_multiple, holds: bt.range_holds, within: bt.within_2x, n: bt.n, sliced: false };
    var errs = cases.map(function (c) { return c.error_multiple; }).sort(function (a, b) { return a - b; });
    var holds = cases.filter(function (c) { return c.actual_usd >= c.predicted_low_usd && c.actual_usd <= c.predicted_high_usd; }).length;
    return {
      miss: Math.round(median(errs) * 1000) / 1000,
      holds: Math.round((holds / cases.length) * 10000) / 10000,
      within: Math.round((cases.filter(function (c) { return c.error_multiple <= 2; }).length / cases.length) * 10000) / 10000,
      n: cases.length, sliced: true
    };
  }

  function kpiStrip(list) {
    var s = DATA.summary || { ranked: DATA.board_size, total_implied_usd: 0, verdicts: { farm: 0, marginal: 0, skip: 0 } };
    var k = kpiNumbers(list);
    var bt = sliceBacktest();
    var sliced = !!state.slice;
    var total = (DATA.summary || {}).reconciliation ? DATA.summary.reconciliation.total : '';
    function cell(label, val, cls, sub) {
      return el('div', { class: 'kpi' },
        el('span', { class: 'k-label', text: label }),
        el('b', { class: 'k-val ' + (cls || ''), text: val }),
        el('span', { class: 'k-sub', text: sub }));
    }
    return el('section', { class: 'kpis', 'aria-label': 'Headline numbers' },
      cell('Ranked', String(k.ranked), '', sliced ? 'in this slice · ' + s.ranked + ' on the board' : 'record no token · of ' + total + ' read'),
      cell('Implied value', fmtUsd(k.total), 'gold', sliced ? 'in this slice · top ' + (k.top ? k.top.name + ' ' + fmtUsd(k.top.implied_value_usd) : 'n/a') : 'summed over the board · #1 ' + (k.top ? k.top.name + ' ' + fmtUsd(k.top.implied_value_usd) : 'n/a')),
      cell('Out-of-sample miss', '×' + bt.miss, '', 'median LOO error · n=' + bt.n + (bt.sliced ? ' in slice' : ' (global)')),
      cell('Range holds', Math.round(bt.holds * 1000) / 10 + '%', '', 'held-out caps inside P25–P75 · n=' + bt.n + (bt.sliced ? ' in slice' : ' (global)')),
      cell('Within 2×', Math.round(bt.within * 1000) / 10 + '%', '', 'of held-out caps within 2× · n=' + bt.n + (bt.sliced ? ' in slice' : ' (global)')),
      cell('Worth farming', String(k.farm), 'green', k.farm + ' farm · ' + k.marginal + ' marginal · ' + k.skip + ' skip' + (sliced ? ' in slice' : ''))
    );
  }

  function reconBar() {
    var rec = (DATA.summary || {}).reconciliation;
    if (!rec) return el('div', { class: 'recon' });
    var segs = [
      { cls: 'seg-ranked', label: 'ranked', n: rec.ranked },
      { cls: 'seg-live', label: 'already trade', n: rec.live_token }
    ];
    var clsByReason = { 'family token already live': 'seg-family', 'versioned pool': 'seg-versioned', 'exchange': 'seg-exchange', 'wrapped, staked or bridged product': 'seg-wrapped' };
    (rec.reasons || []).forEach(function (r) { segs.push({ cls: clsByReason[r.reason] || 'seg-wrapped', label: r.reason, n: r.count }); });
    var bar = el('div', { class: 'recon-bar' },
      segs.map(function (g) { return el('i', { class: g.cls, style: 'width:' + (g.n / rec.total * 100).toFixed(2) + '%', title: g.label + ': ' + g.n }); })
    );
    var legend = el('div', { class: 'recon-legend' },
      el('span', { html: '<b>' + rec.total + '</b> protocols read = ' }),
      segs.map(function (g) { return el('span', { html: '<i class="' + g.cls + '"></i><b>' + g.n + '</b> ' + g.label }); })
    );
    return el('div', { class: 'recon' }, bar, legend);
  }

  function slicesStrip() {
    var cards = sliceCards();
    function card(c) {
      var on = state.slice && state.slice.kind === c.kind && state.slice.value === c.value;
      return el('button', { type: 'button', class: 'slice-card', 'aria-pressed': on ? 'true' : 'false', title: c.value + ': ' + c.n + ' rows, ' + fmtUsd(c.total) + ' implied, median multiple ' + (Math.round(median(c.mults) * 100) / 100) + ', top ' + (c.top ? c.top.name : 'n/a'), onclick: function () { applySlice(c.kind, c.value); } },
        el('span', { class: 'sc-name', html: c.value + ' <span>· ' + c.n + '</span>' }),
        el('span', { class: 'sc-nums', text: fmtUsd(c.total) + ' · ×' + (Math.round(median(c.mults) * 100) / 100) }),
        el('span', { class: 'sc-sub', html: 'top <b>' + (c.top ? c.top.name : 'n/a') + '</b>' })
      );
    }
    function row(tag, list) {
      return el('div', { class: 'slice-row' },
        el('span', { class: 'slice-tag', text: tag }),
        el('div', { class: 'slice-cards' }, list.map(card))
      );
    }
    var strip = el('section', { class: 'slices', 'aria-label': 'Slice the board by chain or category' },
      row('By chain', cards.chains),
      row('By category', cards.categories)
    );
    if (state.slice) strip.appendChild(el('button', { type: 'button', class: 'slice-clear', text: 'Clear slice: ' + state.slice.value + ' ×', onclick: clearSlice }));
    return strip;
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', html: '<b>TOKEN RADAR</b> · pre-token protocols, ranked' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model · no network' })
      )
    );
  }

  function titleRow() {
    return el('div', { class: 'title-row' },
      el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
      el('p', { class: 'sub', text: 'Watchlist = floor: ≥$' + Math.round(DATA.floor_usd / 1e6) + 'M TVL, no token. Early radar adds ' + DATA.early_size + ' below the floor, ' + (DATA.above_size || 0) + ' more above it the watchlist left out. Implied value is a model, not a promise.' })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; if (state.slice && state.slice.kind === 'category' && state.slice.value !== select.value) state.slice = null; writeHash(); render(); });
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; if (state.slice && state.slice.kind === 'chain' && state.slice.value !== chainSelect.value) state.slice = null; writeHash(); render(); });
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    var csv = el('button', { class: 'button', type: 'button', text: 'Download board (CSV)', onclick: downloadCsv });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { text: 'Token status' }), el('div', { class: 'tabs' }, tabBtn('pre-token', 'Pre-token'), tabBtn('live', 'Live token'), tabBtn('backtest', 'Backtest'), tabBtn('audit', 'Audit'))),
      el('div', { class: 'field' }, el('span', { text: 'Export' }), csv),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : state.tab === 'backtest' ? 'Leave-one-out validation' : (DATA.audit || []).length + ' protocols set aside' })
    );
  }

  // The board as CSV, built from the same data.js the table renders.
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCsv() {
    var head = ['rank', 'slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'age_days', 'implied_value_usd', 'implied_low_usd', 'implied_high_usd', 'category_multiple', 'risk_score', 'risk_band', 'scope', 'net_usd', 'gas_usd', 'verdict', 'farm_action'];
    var lines = [head.join(',')];
    DATA.rows.forEach(function (r) {
      lines.push([
        r.rank, r.slug, r.name, r.category || '', (r.chains || []).join(';'), r.tvl_usd,
        r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days,
        r.implied_value_usd, r.implied_low_usd === undefined ? '' : r.implied_low_usd,
        r.implied_high_usd === undefined ? '' : r.implied_high_usd, r.category_multiple,
        r.risk ? r.risk.score : '', r.risk ? r.risk.band : '', scopeOf(r),
        netOf(r) === null ? '' : netOf(r), r.gas_usd === undefined ? '' : r.gas_usd, verdictOf(r), mainFarmAction(r)
      ].map(csvCell).join(','));
    });
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-radar-board.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function verdictBadge(row) {
    var v = verdictOf(row);
    return el('span', { class: 'verdict v-' + v.toLowerCase(), title: v === 'FARM' ? 'Expected value clears gas by $25 or more' : v === 'MARGINAL' ? 'Expected value covers gas, barely' : 'Gas eats the whole expected value', text: v });
  }
  function riskBadge(row) {
    var r = riskOf(row);
    return el('span', { class: 'risk-badge risk-' + r.band, title: (r.reasons[0] || 'No risk read for this protocol.') }, r.band + ' ' + r.score);
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.slice = null; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var net = netOf(r);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + ' · ' }, riskBadge(r))
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('div', null,
            el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
            el('span', { class: 'range', text: r.implied_low_usd === undefined ? '' : fmtUsd(r.implied_low_usd) + '–' + fmtUsd(r.implied_high_usd) })
          )
        )),
        el('td', { class: 'num ' + (net !== null && net < 0 ? 'neg' : ''), text: net === null ? 'n/a' : fmtSigned(net), title: 'Middle expected value less gas ($' + (r.gas_usd === undefined ? '?' : r.gas_usd) + ' gas)' }),
        el('td', null, verdictBadge(r))
      );
      tbody.appendChild(tr);
    });
    var k = kpiNumbers(list);
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model, what-if simulator and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied · P25–P75'),
            sortHeader('net', 'Net of fees'),
            el('th', { scope: 'col', text: 'Verdict' })
          )),
          tbody
        )
      ),
      el('div', { class: 'table-foot', text: list.length + ' rows in view · ' + fmtUsd(k.total) + ' implied · ' + k.farm + ' FARM · ' + k.marginal + ' MARGINAL · ' + k.skip + ' SKIP — net = middle EV less gas; FARM clears gas by $25+' })
    );
  }

  // One era table, shared by the rail and the backtest tab: older half,
  // newer half, and the cases with no listing date outside both halves.
  function eraTable(era) {
    if (!era) return null;
    return el('table', { class: 'era-table' },
      el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Era' }), el('th', { scope: 'col', text: 'n' }), el('th', { scope: 'col', text: 'Within 2×' }), el('th', { scope: 'col', text: 'Median err' }))),
      el('tbody', null,
        el('tr', null, el('td', { text: 'Older half' }), el('td', { class: 'num', text: String(era.older.n) }), el('td', { class: 'num', text: Math.round(era.older.within_2x * 1000) / 10 + '%' }), el('td', { class: 'num', text: '×' + era.older.median_error_multiple })),
        el('tr', null, el('td', { text: 'Newer half' }), el('td', { class: 'num', text: String(era.newer.n) }), el('td', { class: 'num', text: Math.round(era.newer.within_2x * 1000) / 10 + '%' }), el('td', { class: 'num', text: '×' + era.newer.median_error_multiple })),
        el('tr', null, el('td', { text: 'No listing date' }), el('td', { class: 'num', text: String(era.undated) }), el('td', { class: 'num', text: '—' }), el('td', { class: 'num', text: '—' }))
      )
    );
  }
  function caseTable(list) {
    return el('div', { class: 'table-wrap' },
      el('table', { class: 'cal' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Predicted' }), el('th', { scope: 'col', text: 'Actual market cap' }), el('th', { scope: 'col', text: 'Error' }))),
        el('tbody', null, (list || []).map(function (c) {
          return el('tr', null,
            el('td', null, el('b', { text: c.name })),
            el('td', { class: 'num', text: fmtUsd(c.predicted_usd) }),
            el('td', { class: 'num', text: fmtUsd(c.actual_usd) }),
            el('td', { class: 'num', text: c.error_multiple + '×' })
          );
        }))
      )
    );
  }

  // Right rail: the out-of-sample check, beside the board.
  function railPanel() {
    var bt = DATA.backtest || { n: 0, within_2x: 0, spearman: 0, median_error_multiple: 0, range_holds: 0, worst: [], best: [], eras: null };
    function stat(label, val, cls) {
      return el('div', { class: 'rail-stat' }, el('span', { text: label }), el('b', { class: cls || '', text: val }));
    }
    function caseItems(list, good) {
      return el('ul', { class: 'case-list' }, (list || []).slice(0, 3).map(function (c) {
        return el('li', null, el('b', { text: c.name }), el('span', { class: 'num ' + (good ? 'good' : 'bad'), text: c.error_multiple + '×' }));
      }));
    }
    var era = bt.eras;
    return el('aside', { class: 'rail', 'aria-label': 'Out-of-sample check' },
      el('section', { class: 'panel panel-pad' },
        el('h2', { text: 'Out-of-sample check' }),
        el('p', { text: 'Does it hold on tokens it never saw? Leave-one-out: each live-token protocol held out once, calibration refit without it.' }),
        el('div', { class: 'rail-stats' },
          stat('Within 2×', Math.round(bt.within_2x * 1000) / 10 + '%', 'green'),
          stat('Spearman', String(bt.spearman), ''),
          stat('Median error', '×' + bt.median_error_multiple, 'gold'),
          stat('Range holds', Math.round(bt.range_holds * 1000) / 10 + '%', '')
        ),
        el('p', { html: 'Ranks directionally (Spearman <b>' + bt.spearman + '</b>, n=<b>' + bt.n + '</b>) but point estimates miss by <b>×' + bt.median_error_multiple + '</b>; only <b>' + Math.round(bt.within_2x * 1000) / 10 + '%</b> land within 2×. The P25–P75 band holds the actual cap <b>' + Math.round(bt.range_holds * 1000) / 10 + '%</b> of the time — near a half, as a quartile band should.' }),
        el('h3', { text: 'By era — has it gone stale?' }),
        eraTable(era),
        el('p', { text: 'The newer half misses more than the older half: the market moved on, the multiples did not. Implied value is a ranking signal, not a price.' }),
        el('h3', { text: 'Worst misses' }),
        caseItems(bt.worst, false),
        el('h3', { text: 'Best calls' }),
        caseItems(bt.best, true),
        el('p', { text: 'Sibling pools stay in the pool while a sibling is held out, so these errors are, if anything, a little optimistic.' })
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'sub', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cal = DATA.calibration || { global_median_ratio: m.base_multiple, categories: [] };
    var calRows = (cal.categories || []).map(function (c) {
      return el('tr', {
        tabindex: '0',
        title: 'Filter the board to ' + c.category,
        onclick: function () { state.category = c.category; state.tab = 'pre-token'; writeHash(); render(); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.category = c.category; state.tab = 'pre-token'; writeHash(); render(); } }
      },
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.live_n) }),
        el('td', { class: 'num', text: c.median_ratio === null ? 'n/a' : String(c.median_ratio) }),
        el('td', { class: 'num', text: (c.p25_ratio === null || c.p25_ratio === undefined ? 'n/a' : String(c.p25_ratio)) + ' – ' + (c.p75_ratio === null || c.p75_ratio === undefined ? 'n/a' : String(c.p75_ratio)) }),
        el('td', { class: 'num', text: c.shrinkage_weight === undefined ? 'n/a' : String(c.shrinkage_weight) }),
        el('td', { class: 'num', text: String(c.multiple) })
      );
    });
    return el('section', { class: 'panel panel-pad model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row. No protocol name is special-cased, no row hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + 0.02 x min(chains - 1, 4)) )'
      ),
      el('p', { class: 'sub', text: 'The category multiple is the median market-cap / TVL of live-token protocols in that category, shrunk toward the global median of ' + cal.global_median_ratio + ' with a prior of 10, clamped to 0.05–0.80. Fewer than 5 live tokens takes the global median. Exchanges are left out entirely: their rows are never ranked, and one of their ratios is 69.4. Age is time since first listing; an unlisted age uses the median pre-token age of ' + (DATA.median_age_days === null ? m.unknown_age_days : DATA.median_age_days) + ' days.' }),
      el('h3', { text: 'Calibration: live-token market cap per TVL dollar, by category' }),
      el('p', { class: 'sub', text: 'Select a row to filter the board to that category. P25–P75 is the ratio distribution the row band comes from; weight is the share the category’s own median carries against the global median.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'cal' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Live tokens' }),
            el('th', { scope: 'col', text: 'Median ratio' }),
            el('th', { scope: 'col', text: 'P25 – P75' }),
            el('th', { scope: 'col', text: 'Weight' }),
            el('th', { scope: 'col', text: 'Multiple used' })
          )),
          el('tbody', null, calRows)
        )
      ),
      el('p', { class: 'sub', text: 'A multiple is a market average, not a promise: a token that launches may trade far above or below it, and a protocol may never launch one at all.' })
    );
  }

  function backtestPanel() {
    var bt = DATA.backtest || { n: 0, within_2x: 0, within_3x: 0, spearman: 0, median_error_multiple: 0, range_holds: 0, worst: [], best: [], eras: null, note: '' };
    var era = bt.eras;
    function fact(label, val) {
      return el('div', { class: 'fact' }, el('span', { text: label }), el('b', { text: val }));
    }
    return el('section', { class: 'panel panel-pad' },
      el('h2', { text: 'Backtest: the model against the market' }),
      el('p', { class: 'sub', text: 'Leave-one-out on the live-token set: each protocol held out once, calibration refit without it, model predicts its market cap as if the token had not launched. A protocol never calibrates its own prediction.' }),
      el('div', { class: 'facts' },
        fact('Protocols scored', String(bt.n)),
        fact('Within 2× of the market', Math.round(bt.within_2x * 1000) / 10 + '%'),
        fact('Within 3× of the market', Math.round(bt.within_3x * 1000) / 10 + '%'),
        fact('Rank correlation (Spearman)', String(bt.spearman)),
        fact('Median error', String(bt.median_error_multiple) + '×'),
        fact('Range holds (P25–P75)', Math.round(bt.range_holds * 1000) / 10 + '%')
      ),
      el('p', { class: 'sub', text: 'Read it plainly: the model ranks directionally (Spearman ' + bt.spearman + ', n=' + bt.n + ') but point estimates are usually off by ' + bt.median_error_multiple + '×, and only ' + Math.round(bt.within_2x * 1000) / 10 + '% land within twice the market cap. Treat implied value as a ranking signal, not a price. The worst misses are a tiny TVL with a large market cap, or a bridge whose token barely trades.' }),
      era ? el('div', null,
        el('h3', { text: 'By era — has it gone stale?' }),
        el('p', { class: 'sub', text: 'The ' + (era.older.n + era.newer.n) + ' cases with a listing date, split older / newer; ' + era.undated + ' record no date and sit outside both halves.' }),
        eraTable(era),
        el('p', { class: 'sub', text: 'The newer half misses more: the market moved on, the multiples did not. A multiple calibrated on yesterday’s launches lags, and the board’s ranks inherit that lag.' })
      ) : null,
      el('h3', { text: 'Worst predictions' }),
      caseTable(bt.worst),
      el('h3', { text: 'Best predictions' }),
      caseTable(bt.best),
      el('p', { class: 'sub', text: bt.note || '' })
    );
  }

  function auditPanel() {
    var audit = DATA.audit || [];
    var rec = (DATA.summary || {}).reconciliation;
    var counts = {};
    audit.forEach(function (a) { counts[a.reason] = (counts[a.reason] || 0) + 1; });
    var rows = audit.map(function (a) {
      return el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: a.name }), el('span', { class: 'sub', text: (a.category || 'Other') }))),
        el('td', { class: 'num', text: fmtUsd(a.tvl_usd) }),
        el('td', { text: a.reason + (a.symbol ? ' — ' + a.symbol : '') })
      );
    });
    return el('section', { class: 'panel panel-pad' },
      el('h2', { text: 'Audit: what the board sets aside, and why' }),
      el('p', { class: 'sub', text: audit.length + ' pre-token protocols set aside: ' + (counts['family token already live'] || 0) + ' pools of a family whose token already trades, ' + (counts['versioned pool'] || 0) + ' versioned pools, ' + (counts['exchange'] || 0) + ' exchanges, ' + (counts['wrapped, staked or bridged product'] || 0) + ' wrapped, staked or bridged products above the floor. Another ' + (DATA.live_set_aside || 0) + ' already trade; the 24 largest are in the Live token tab. Every protocol is accounted for: board, live tab, or this audit.' + (rec ? ' ' + rec.total + ' read = ' + rec.ranked + ' ranked + ' + rec.live_token + ' live + ' + rec.set_aside + ' set aside.' : '') }),
      el('p', { class: 'sub', text: 'Family rule: a record naming a token symbol is a pool of a family that already launched — the symbol is the evidence, shown beside the reason. A name stripped of product words matching a live-token protocol’s name counts the same way. Bridges are not family matches: a bridge carries its chain’s token. Above the floor, wrapped, staked and bridged products stay out because they are the token already: WBTC is Bitcoin on Ethereum. Below the floor, bridges and liquid-staking pools stay ranked.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Reason set aside' }))),
          el('tbody', null, rows)
        )
      )
    );
  }

  // The farm steps arrive in each row from main.ts (lib/model.ts farmSteps):
  // the page renders them, never re-derives them, so the drawer and the CSV
  // can never disagree with board.json.
  function stepsOf(row) { return row.farm_steps || []; }
  function mainFarmAction(row) {
    var steps = stepsOf(row);
    if (steps.length < 2) return '';
    var s = steps[1];
    var at = s.indexOf(' Cost: ');
    var action = at >= 0 ? s.slice(0, at) : s;
    return action.length > 90 ? action.slice(0, 87) + '...' : action;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('slice')) {
      var parts = params.get('slice').split(':');
      if (parts.length === 2 && (parts[0] === 'chain' || parts[0] === 'category')) {
        state.slice = { kind: parts[0], value: parts[1] };
        if (parts[0] === 'chain') state.chain = parts[1]; else state.category = parts[1];
      }
    }
    if (params.get('tab') && ['pre-token', 'live', 'backtest', 'audit'].indexOf(params.get('tab')) >= 0) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.slice) params.set('slice', state.slice.kind + ':' + state.slice.value);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function riskDetailSection(row) {
    var r = riskOf(row);
    var items = (r.reasons || []).map(function (reason) { return el('li', { text: reason }); });
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Risk: ' + r.band + ' (' + r.score + '/100)' }),
      el('p', { class: 'sub', text: 'Six named factors: a baseline launch risk every pre-token protocol carries, then chain concentration, track record, seven-day momentum, book depth and category-relative strength. No row scores zero: the baseline alone is 4–8 points.' }),
      items.length > 0 ? el('ul', { class: 'reasons' }, items) : el('p', { class: 'sub', text: 'No risk read was computed for this protocol.' })
    );
  }
  function bandDetailSection(row) {
    var low = row.implied_low_usd === undefined ? null : row.implied_low_usd;
    var high = row.implied_high_usd === undefined ? null : row.implied_high_usd;
    if (low === null || high === null) {
      return el('section', { class: 'detail-section' },
        el('h3', { text: 'Uncertainty band' }),
        el('p', { class: 'sub', text: 'No band was computed for this protocol.' })
      );
    }
    var out = el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) });
    var slider = el('input', { type: 'range', min: '0', max: '100', value: '50', 'aria-label': 'Bear to bull scenario' });
    slider.addEventListener('input', function () {
      var t = Number(slider.value) / 100;
      var v = Math.round(low + (high - low) * t);
      out.textContent = fmtUsd(v) + (Number(slider.value) === 50 ? ' (base case)' : Number(slider.value) < 50 ? ' (bear-leaning)' : ' (bull-leaning)');
    });
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Uncertainty band: ' + fmtUsd(low) + ' – ' + fmtUsd(high) }),
      el('p', { class: 'sub', text: 'The same product with the category’s P25 and P75 market-cap / TVL ratios as the multiple: the bear case is what the weakest quarter of live tokens in this category trades at per TVL dollar, the bull case what the strongest quarter trades at.' }),
      el('div', { class: 'scenario' },
        el('span', { class: 'sub', text: 'Bear (P25)' }),
        slider,
        el('span', { class: 'sub', text: 'Bull (P75)' })
      ),
      el('p', null, el('span', { text: 'Scenario implied value: ' }), out)
    );
  }
  function sizedPlanDetailSection(row) {
    var p = planOf(row);
    if (!p) return el('section', { class: 'detail-section' }, el('h3', { text: 'Sized farm plan' }), el('p', { class: 'sub', text: 'No sized plan was computed for this protocol.' }));
    function pcell(label, val, mono) {
      return el('div', null, el('span', { text: label }), el('b', { class: mono ? 'num' : '', text: val }));
    }
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Sized farm plan' }),
      el('div', { class: 'plan-grid' },
        pcell('Position', '$' + p.capitalUsd + ' (' + p.sizeBand + ')', true),
        pcell('Expected value', '$' + p.evLowUsd + '–$' + p.evHighUsd, true),
        pcell('Middle outcome', '$' + p.evMidUsd, true),
        pcell('Return on capital', p.roiMultiple + '× (' + p.roiBand + ')', true),
        pcell('Hold at least', p.holdDays + ' days', true),
        pcell('Cadence', p.cadence)
      ),
      el('p', { class: 'sub', text: p.rationale }),
      el('p', { class: 'sub', text: 'EV assumes 5% of the implied value reaches farmers, split among about 50,000 active farmers; the range runs from a quarter to two and a half times the middle share.' })
    );
  }

  // What-if simulator: a deposit slider recomputing this row's EV range, net
  // after gas and ROI for the chosen deposit. EV scales with deposit share
  // (the plan's EV is for its own capital, so twice the deposit doubles the
  // EV); gas is the plan's own gas and does not grow with the deposit, so a
  // bigger deposit clears gas more easily. ROI is flat in the deposit: the
  // slider moves the dollars, not the multiple.
  function whatIfSection(row) {
    var p = planOf(row);
    if (!p) return el('section', { class: 'detail-section' }, el('h3', { text: 'What if I deposit more — or less?' }), el('p', { class: 'sub', text: 'No sized plan was computed for this protocol.' }));
    var gas = row.gas_usd === undefined ? 0 : row.gas_usd;
    var start = Math.min(1000, Math.max(25, p.capitalUsd));
    var depositOut = el('b', { class: 'num', text: '$' + start });
    var evOut = el('b', { class: 'num', text: '' });
    var netOut = el('b', { class: 'num', text: '' });
    var roiOut = el('b', { class: 'num', text: '' });
    var bearBar = el('i', { style: 'width:0%' });
    var baseBar = el('i', { style: 'width:0%' });
    var bullBar = el('i', { style: 'width:0%' });
    var bearVal = el('span', { class: 'num', text: '' });
    var baseVal = el('span', { class: 'num', text: '' });
    var bullVal = el('span', { class: 'num', text: '' });
    function recompute(deposit) {
      var scale = deposit / p.capitalUsd;
      var low = Math.max(1, Math.round(p.evLowUsd * scale));
      var mid = Math.max(1, Math.round(p.evMidUsd * scale));
      var high = Math.round(p.evHighUsd * scale);
      var net = Math.round((mid - gas) * 10) / 10;
      depositOut.textContent = '$' + deposit;
      evOut.textContent = '$' + low + '–$' + high;
      netOut.textContent = fmtSigned(net);
      netOut.className = 'num ' + (net < 0 ? 'red' : 'green');
      roiOut.textContent = (Math.round((mid / deposit) * 100) / 100) + '×';
      var top = Math.max(high, 1);
      bearBar.style.width = Math.max(2, Math.round((low / top) * 100)) + '%';
      baseBar.style.width = Math.max(2, Math.round((mid / top) * 100)) + '%';
      bullBar.style.width = '100%';
      bearVal.textContent = '$' + low;
      baseVal.textContent = '$' + mid;
      bullVal.textContent = '$' + high;
    }
    var slider = el('input', { type: 'range', min: '25', max: '1000', step: '25', value: String(start), 'aria-label': 'Deposit in dollars' });
    slider.addEventListener('input', function () { recompute(Number(slider.value)); });
    recompute(start);
    function wbar(label, cls, bar, val) {
      return el('div', { class: 'wif-bar' }, el('span', { class: 'lbl', text: label }), el('div', { class: 'track ' + cls }, bar), val);
    }
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'What if I deposit more — or less?' }),
      el('p', { class: 'sub', text: 'The plan sizes this row at $' + p.capitalUsd + ' for ' + p.holdDays + ' days. Move the slider to see what the same position is worth at your deposit.' }),
      el('div', { class: 'scenario' },
        el('span', { class: 'sub', text: '$25' }),
        slider,
        el('span', { class: 'sub', text: '$1,000' })
      ),
      el('p', null, el('span', { text: 'Deposit: ' }), depositOut),
      el('div', { class: 'wif-grid' },
        el('div', { class: 'wif-cell' }, el('span', { text: 'Expected value' }), evOut),
        el('div', { class: 'wif-cell' }, el('span', { text: 'Net after gas' }), netOut),
        el('div', { class: 'wif-cell' }, el('span', { text: 'ROI multiple' }), roiOut)
      ),
      el('div', { class: 'wif-bars' },
        wbar('Bear', 'bear', bearBar, bearVal),
        wbar('Base', 'base', baseBar, baseVal),
        wbar('Bull', 'bull', bullBar, bullVal)
      ),
      el('p', { class: 'sub', text: 'Assumptions: EV scales with deposit share — the plan’s EV is for its own $' + p.capitalUsd + ', so twice the deposit doubles the EV. Gas is the plan’s own ($' + gas + ') and does not grow with the deposit. ROI is flat for the same reason.' })
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = stepsOf(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + verdictOf(row) + ' · net ' + fmtSigned(netOf(row)) }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    function eqRow(label, val) {
      return el('div', null, el('span', { text: label }), el('b', { class: 'num', text: val }));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        eqRow('TVL', fmtUsd(row.tvl_usd)),
        eqRow('Category multiple (' + (row.category || 'Other') + ')', String(row.category_multiple)),
        eqRow('Seven-day growth', fmtPct(row.change_7d)),
        eqRow('Age with no token', fmtAge(row.age_days)),
        eqRow('Growth multiplier', String(row.growth_multiplier)),
        eqRow('Maturity multiplier', String(row.maturity_multiplier)),
        eqRow('Chain factor (' + (row.chains || []).length + ' chains)', String(row.chain_factor)),
        eqRow('Implied value', fmtUsd(row.implied_value_usd))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(whatIfSection(row));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    dialog.appendChild(bandDetailSection(row));
    dialog.appendChild(riskDetailSection(row));
    dialog.appendChild(sizedPlanDetailSection(row));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(titleRow());
    var list = rows();
    shell.appendChild(kpiStrip(list));
    shell.appendChild(reconBar());
    if (state.tab === 'pre-token') shell.appendChild(slicesStrip());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') {
      var grid = el('div', { class: 'board-grid' });
      grid.appendChild(boardTable());
      grid.appendChild(railPanel());
      shell.appendChild(grid);
      shell.appendChild(modelPanel());
    } else if (state.tab === 'live') {
      shell.appendChild(liveTable());
    } else if (state.tab === 'backtest') {
      shell.appendChild(backtestPanel());
    } else {
      shell.appendChild(auditPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    window.__shotReady = true;
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
