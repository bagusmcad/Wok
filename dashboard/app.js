// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', scope: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  state.risk = 'all';

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
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
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  // radar-3: the base multiple is the category's calibrated mcap/TVL (median of live tokens in
  // that category, shrunk to the global median, exchanges left out of the calibration); maturity
  // saturates at 730 days; an unknown age uses the median pre-token age; multi-chain adds 2% a
  // chain, at most 8%. The band runs the same product with the category's P25/P75 ratios.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? (DATA.median_age_days === null || DATA.median_age_days === undefined ? model.unknown_age_days : DATA.median_age_days) : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var multiple = row.category_multiple === undefined ? model.base_multiple : row.category_multiple;
    var chainFactor = row.chain_factor === undefined ? 1 : row.chain_factor;
    return Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturity * chainFactor));
  }
  function mainFarmAction(row) {
    var steps = farmSteps(row);
    if (steps.length < 2) return '';
    var s = steps[1];
    var at = s.indexOf(' Cost: ');
    var action = at >= 0 ? s.slice(0, at) : s;
    return action.length > 90 ? action.slice(0, 87) + '...' : action;
  }

  // The risk read and the sized plan arrive in each row from main.ts (lib/risk.ts
  // and lib/farmplan.ts). The page only renders them, and an older data.js that
  // carries neither field still renders with a plain fallback instead of breaking.
  function riskOf(row) { return row.risk || { score: 0, band: 'low', reasons: [] }; }
  function planOf(row) { return row.farmPlan || null; }
  function riskBadge(row) {
    var r = riskOf(row);
    return el('span', { class: 'risk-badge risk-' + r.band, title: (r.reasons[0] || 'No risk read for this protocol.') }, r.band + ' ' + r.score);
  }
  function planLine(row) {
    var p = planOf(row);
    if (!p) return 'n/a';
    return '$' + p.capitalUsd + ' ' + p.sizeBand + ' · hold ' + p.holdDays + 'd · EV $' + p.evLowUsd + '–$' + p.evHighUsd;
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

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('scope')) state.scope = params.get('scope');
    if (params.get('risk')) state.risk = params.get('risk');
    if (params.get('tab') && ['pre-token', 'live', 'backtest', 'audit'].indexOf(params.get('tab')) >= 0) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.risk !== 'all') params.set('risk', state.risk);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Where a row came from: the watchlist, the early radar below the floor, or
  // above the floor left out by the watchlist. Older data.js files carry no
  // scope, and fall back to the floor rule.
  function scopeOf(r) { return r.scope || (r.tvl_usd >= DATA.floor_usd ? 'watchlist' : 'early'); }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.scope === 'watchlist' && scopeOf(r) !== 'watchlist') return false;
      if (state.scope === 'early' && scopeOf(r) !== 'early') return false;
      if (state.scope === 'above' && scopeOf(r) !== 'above') return false;
      if (state.risk !== 'all' && (!r.risk || r.risk.band !== state.risk)) return false;
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
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var bt = DATA.backtest || { n: 0, within_2x: 0, spearman: 0, median_error_multiple: 0 };
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, and ' + (DATA.above_size || 0) + ' more above it that the watchlist left out but are launches of their own. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Above the floor, left out' }), el('b', { text: String(DATA.above_size || 0) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Backtest: within 2x of the market' }), el('b', { text: bt.n > 0 ? Math.round(bt.within_2x * 1000) / 10 + '% (n=' + bt.n + ')' : 'not run' }))
      )
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
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var scopeSelect = el('select', { id: 'scope', 'aria-label': 'Filter by scope' },
      el('option', { value: 'all', text: 'Watchlist + early + above' }),
      el('option', { value: 'watchlist', text: 'Watchlist only', selected: state.scope === 'watchlist' ? 'selected' : null }),
      el('option', { value: 'early', text: 'Early (below floor) only', selected: state.scope === 'early' ? 'selected' : null }),
      el('option', { value: 'above', text: 'Above the floor, left out', selected: state.scope === 'above' ? 'selected' : null })
    );
    scopeSelect.addEventListener('change', function () { state.scope = scopeSelect.value; writeHash(); render(); });
    var riskSelect = el('select', { id: 'risk', 'aria-label': 'Filter by risk band' },
      el('option', { value: 'all', text: 'All risk bands' }),
      ['low', 'medium', 'high'].map(function (b) { return el('option', { value: b, text: b.charAt(0).toUpperCase() + b.slice(1) + ' risk', selected: state.risk === b ? 'selected' : null }); })
    );
    riskSelect.addEventListener('change', function () { state.risk = riskSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var backtest = el('button', { type: 'button', 'aria-pressed': state.tab === 'backtest' ? 'true' : 'false', text: 'Backtest', onclick: function () { state.tab = 'backtest'; writeHash(); render(); } });
    var audit = el('button', { type: 'button', 'aria-pressed': state.tab === 'audit' ? 'true' : 'false', text: 'Audit', onclick: function () { state.tab = 'audit'; writeHash(); render(); } });
    var csv = el('button', { class: 'button', type: 'button', text: 'Download board (CSV)', onclick: downloadCsv });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'scope', text: 'Scope' }), scopeSelect),
      el('div', { class: 'field' }, el('label', { for: 'risk', text: 'Risk' }), riskSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live, backtest, audit)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Export' }), csv),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : state.tab === 'backtest' ? 'Leave-one-out validation of the model' : (DATA.audit || []).length + ' protocols set aside' })
    );
  }

  // The whole board as a CSV, built in the page from the same data.js the
  // table renders, so the download and the board can never disagree.
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCsv() {
    var head = ['rank', 'slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'age_days', 'implied_value_usd', 'implied_low_usd', 'implied_high_usd', 'category_multiple', 'risk_score', 'risk_band', 'scope', 'farm_action'];
    var lines = [head.join(',')];
    DATA.rows.forEach(function (r) {
      lines.push([
        r.rank, r.slug, r.name, r.category || '', (r.chains || []).join(';'), r.tvl_usd,
        r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days,
        r.implied_value_usd, r.implied_low_usd === undefined ? '' : r.implied_low_usd,
        r.implied_high_usd === undefined ? '' : r.implied_high_usd, r.category_multiple,
        r.risk ? r.risk.score : '', r.risk ? r.risk.band : '', scopeOf(r), mainFarmAction(r)
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

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'sub', text: r.implied_low_usd === undefined ? '' : 'P25–P75 ' + fmtUsd(r.implied_low_usd) + '–' + fmtUsd(r.implied_high_usd) })
        )),
        el('td', null, riskBadge(r)),
        el('td', null, el('span', { class: 'farm-cell', text: mainFarmAction(r) })),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('risk', 'Risk'),
            el('th', { scope: 'col', text: 'Farm it' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function spotlight() {
    var top = DATA.rows.slice(0, 3);
    return el('section', { class: 'spotlight', 'aria-label': 'Top three by implied value' },
      top.map(function (r) {
        return el('article', { class: 'spot', tabindex: '0', onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
          el('span', { class: 'spot-rank', text: '#' + r.rank }),
          el('h2', { text: r.name }),
          el('p', { class: 'sub', text: (r.category || 'Other') + ' · TVL ' + fmtUsd(r.tvl_usd) + ' · ' + fmtPct(r.change_7d) + ' in 7d' }),
          el('b', { class: 'spot-value', text: fmtUsd(r.implied_value_usd) + ' implied' }),
          el('p', { class: 'sub', text: mainFarmAction(r) })
        );
      })
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
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cal = DATA.calibration || { global_median_ratio: m.base_multiple, global_p25_ratio: m.base_multiple, global_p75_ratio: m.base_multiple, categories: [] };
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
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + 0.02 x min(chains - 1, 4)) )'
      ),
      el('p', { class: 'sub', text: 'The category multiple is calibrated on this snapshot: the median market-cap / TVL of the live-token protocols in the same category, shrunk toward the global median of ' + cal.global_median_ratio + ' with a prior of 10 live protocols, clamped to 0.05–0.80. A category with fewer than 5 live tokens takes the global median. Exchanges are left out of the calibration entirely: their rows are never ranked, and one of their ratios is 69.4. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses the median pre-token age of ' + (DATA.median_age_days === null ? m.unknown_age_days : DATA.median_age_days) + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown. Above the floor, the board also ranks the rankable protocols the watchlist left out that are not wrapped, staked or bridged products of a token that already trades.' }),
      el('h3', { text: 'Calibration: live-token market cap per TVL dollar, by category' }),
      el('p', { class: 'sub', text: 'Select a row to filter the board to that category. P25–P75 is the same ratio distribution the row band comes from; the weight is the share the category\u2019s own median carries against the global median (0 when the category borrows it outright).' }),
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
    var bt = DATA.backtest || { n: 0, within_2x: 0, within_3x: 0, spearman: 0, median_error_multiple: 0, worst: [], best: [], note: '' };
    function caseRows(list) {
      return (list || []).map(function (c) {
        return el('tr', null,
          el('td', null, el('b', { text: c.name })),
          el('td', { class: 'num', text: fmtUsd(c.predicted_usd) }),
          el('td', { class: 'num', text: fmtUsd(c.actual_usd) }),
          el('td', { class: 'num', text: c.error_multiple + 'x' })
        );
      });
    }
    return el('section', { class: 'panel' },
      el('h2', { text: 'Backtest: the model against the market' }),
      el('p', { class: 'sub', text: 'Leave-one-out validation on the live-token set: each live-token protocol is held out once, the calibration is refit without it, and the model predicts its market cap as if the token had not launched yet. The prediction is then compared with the market cap the market actually gives it. A protocol never calibrates its own prediction.' }),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Protocols scored' }), el('b', { text: String(bt.n) })),
        el('div', { class: 'fact' }, el('span', { text: 'Within 2x of the market' }), el('b', { text: Math.round(bt.within_2x * 1000) / 10 + '%' })),
        el('div', { class: 'fact' }, el('span', { text: 'Within 3x of the market' }), el('b', { text: Math.round(bt.within_3x * 1000) / 10 + '%' })),
        el('div', { class: 'fact' }, el('span', { text: 'Rank correlation (Spearman)' }), el('b', { text: String(bt.spearman) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median error' }), el('b', { text: String(bt.median_error_multiple) + 'x' }))
      ),
      el('p', { class: 'sub', text: 'Read it plainly: the model ranks directionally — a rank correlation of ' + bt.spearman + ' over ' + bt.n + ' protocols — but its point estimates are usually off by about ' + bt.median_error_multiple + 'x, and only ' + Math.round(bt.within_2x * 1000) / 10 + '% land within twice the market cap. Treat the implied value as a ranking signal, not a price. The worst misses are protocols whose token trades far above any TVL multiple (a tiny TVL with a large market cap) or far below it (a bridge whose token barely trades).' }),
      el('h3', { text: 'Worst predictions' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'cal' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Predicted' }), el('th', { scope: 'col', text: 'Actual market cap' }), el('th', { scope: 'col', text: 'Error' }))),
          el('tbody', null, caseRows(bt.worst))
        )
      ),
      el('h3', { text: 'Best predictions' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'cal' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Predicted' }), el('th', { scope: 'col', text: 'Actual market cap' }), el('th', { scope: 'col', text: 'Error' }))),
          el('tbody', null, caseRows(bt.best))
        )
      ),
      el('p', { class: 'sub', text: bt.note || '' })
    );
  }

  function auditPanel() {
    var audit = DATA.audit || [];
    var counts = {};
    audit.forEach(function (a) { counts[a.reason] = (counts[a.reason] || 0) + 1; });
    var rows = audit.map(function (a) {
      var reason = a.reason + (a.symbol ? ' — ' + a.symbol : '');
      return el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: a.name }), el('span', { class: 'sub', text: (a.category || 'Other') }))),
        el('td', { class: 'num', text: fmtUsd(a.tvl_usd) }),
        el('td', { text: reason })
      );
    });
    return el('section', { class: 'panel' },
      el('h2', { text: 'Audit: what the board sets aside, and why' }),
      el('p', { class: 'sub', text: audit.length + ' pre-token protocols are set aside from the board: ' + (counts['family token already live'] || 0) + ' pools of a family whose token already trades, ' + (counts['versioned pool'] || 0) + ' versioned pools, ' + (counts['exchange'] || 0) + ' exchanges, and ' + (counts['wrapped, staked or bridged product'] || 0) + ' wrapped, staked or bridged products above the floor. Another ' + (DATA.live_set_aside || 0) + ' protocols already trade; the 24 largest are shown with their market caps in the Live token tab. Every protocol in the snapshot is accounted for: board, live tab, or this audit. Nothing is hidden: each exclusion names its reason, so a reader can argue with it.' }),
      el('p', { class: 'sub', text: 'The family rule: a protocol whose record names a token symbol is a pool of a family that already launched — the symbol is the evidence, shown beside the reason. A protocol whose name, stripped of product words, matches a live-token protocol\u2019s name counts the same way. Bridges are not counted as family matches, because a bridge carries its chain\u2019s token. Above the floor, wrapped, staked and bridged products stay out because they are the token already, not a launch of its own: WBTC is Bitcoin on Ethereum. Below the floor, bridges and liquid-staking pools stay ranked, because the watchlist is a floor, never a ceiling.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Reason set aside' }))),
          el('tbody', null, rows)
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  // Detail sections for the risk read and the sized plan. Each renders only what
  // main.ts computed for the row; an older data.js without those fields shows a
  // short note instead of an empty section.
  function riskDetailSection(row) {
    var r = riskOf(row);
    var items = (r.reasons || []).map(function (reason) { return el('li', { text: reason }); });
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Risk: ' + r.band + ' (' + r.score + '/100)' }),
      el('p', { class: 'sub', text: 'Six named factors add up to the score: a baseline launch risk that every pre-token protocol carries, then chain concentration, track record, seven-day momentum, book depth and category-relative strength. No row scores zero: the baseline alone is 4–8 points.' }),
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
      el('p', { class: 'sub', text: 'The same product with the category\u2019s P25 and P75 market-cap / TVL ratios in place of the multiple: the bear case is what the weakest quarter of live tokens in this category trades at per TVL dollar, the bull case what the strongest quarter trades at. The point estimate sits between them. Drag the slider to see the scenario value.' }),
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
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Sized farm plan' }),
      el('div', { class: 'plan-grid' },
        el('div', null, el('span', { text: 'Position' }), el('b', { class: 'num', text: '$' + p.capitalUsd + ' (' + p.sizeBand + ')' })),
        el('div', null, el('span', { text: 'Expected value' }), el('b', { class: 'num', text: '$' + p.evLowUsd + '–$' + p.evHighUsd })),
        el('div', null, el('span', { text: 'Middle outcome' }), el('b', { class: 'num', text: '$' + p.evMidUsd })),
        el('div', null, el('span', { text: 'Return on capital' }), el('b', { class: 'num', text: p.roiMultiple + 'x (' + p.roiBand + ')' })),
        el('div', null, el('span', { text: 'Hold at least' }), el('b', { class: 'num', text: p.holdDays + ' days' })),
        el('div', null, el('span', { text: 'Cadence' }), el('b', { text: p.cadence }))
      ),
      el('p', { class: 'sub', text: p.rationale }),
      el('p', { class: 'sub', text: 'Expected value assumes 5% of the implied value reaches farmers, split among about 50,000 active farmers; the range runs from a quarter to two and a half times the middle share.' })
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var comparables = DATA.live.filter(function (l) { return l.category === row.category && l.mcap_tvl_ratio !== null; }).slice(0, 3);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: String(row.category_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain factor (' + (row.chains || []).length + ' chains)' }), el('b', { class: 'num', text: String(row.chain_factor) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    if (comparables.length > 0) {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Live comparables in ' + (row.category || 'Other') }),
        el('p', { class: 'sub', text: 'Tokens that already trade in this category, with the market cap the market actually gives each TVL dollar. The category multiple above is the median of these ratios, shrunk to the global median.' }),
        el('ul', { class: 'comparables' }, comparables.map(function (l) {
          return el('li', null, el('b', { text: l.name }), el('span', { class: 'num', text: 'mcap/TVL ' + String(l.mcap_tvl_ratio) + ' · mcap ' + fmtUsd(l.mcap_usd) }));
        }))
      ));
    }
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
    shell.appendChild(lede());
    if (state.tab === 'pre-token') shell.appendChild(spotlight());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') {
      shell.appendChild(boardTable());
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
