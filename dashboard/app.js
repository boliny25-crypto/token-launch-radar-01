// Token Launch Radar dashboard. Reads window.RADAR from ../data.js (written by main.ts beside
// this directory) and renders the ranked board with sorting and filters, one detail view per
// protocol with the model's basis and the farm plan, and the live-token table for scale.
// No network, no storage: the address bar (query string plus hash) carries the view state.
(function () {
  'use strict';

  var R = window.RADAR;
  var main = document.getElementById('board');
  var sub = document.getElementById('sub');
  var foot = document.getElementById('foot');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function commas(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function usd(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + commas(n);
  }
  function fullUsd(n) { return n == null ? '—' : '$' + commas(n); }
  function pct(x) { return x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(1) + '%'; }
  function mult(x) { return (x < 0.1 ? x.toFixed(3) : x.toFixed(2)) + '×'; }
  function age(d) {
    if (d == null) return '—';
    if (d >= 730) return (d / 365.25).toFixed(1) + ' yrs';
    if (d >= 60) return Math.round(d / 30.44) + ' mo';
    return d + ' d';
  }
  function signed(x, digits) { return (x > 0 ? '+' : '') + x.toFixed(digits); }

  if (!R || !R.rows) {
    main.innerHTML = '<section class="card"><h2>The board data did not load</h2>' +
      '<p>data.js sits beside this directory and is written by the radar program; without it there is nothing to rank.</p></section>';
    main.setAttribute('aria-busy', 'false');
    return;
  }

  /* ---------- view state, from the address bar ---------- */
  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    chain: params.get('chain') || '',
    cat: params.get('cat') || '',
    band: params.get('band') || '',
    set: params.get('set') || 'all',
    sort: params.get('sort') || 'rank',
    dir: params.get('dir') === 'desc' ? -1 : 1
  };
  var BANDS = [
    ['', 'Any value'],
    ['ge1b', 'Implied ≥ $1B'],
    ['100m', 'Implied $100M – $1B'],
    ['10m', 'Implied $10M – $100M'],
    ['lt10m', 'Implied < $10M']
  ];
  function inBand(v) {
    if (state.band === 'ge1b') return v >= 1e9;
    if (state.band === '100m') return v >= 1e8 && v < 1e9;
    if (state.band === '10m') return v >= 1e7 && v < 1e8;
    if (state.band === 'lt10m') return v < 1e7;
    return true;
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return R.rows.filter(function (r) {
      if (state.set === 'watch' && !r.watchlist) return false;
      if (state.set === 'early' && r.watchlist) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (state.cat === '__none' ? r.category !== null : (state.cat && r.category !== state.cat)) return false;
      if (!inBand(r.implied_value_usd)) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
  }
  var SORTVAL = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d == null ? -Infinity : r.change_7d; },
    value: function (r) { return r.implied_value_usd; },
    multiple: function (r) { return r.multiple; },
    age: function (r) { return r.age_days == null ? -1 : r.age_days; }
  };
  function sortedRows() {
    var f = SORTVAL[state.sort] || SORTVAL.rank;
    return filtered().sort(function (a, b) {
      var x = f(a), y = f(b);
      var c = (typeof x === 'string') ? (x < y ? -1 : x > y ? 1 : 0) : x - y;
      return c * state.dir || a.rank - b.rank;
    });
  }
  function syncUrl() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.chain) p.set('chain', state.chain);
    if (state.cat) p.set('cat', state.cat);
    if (state.band) p.set('band', state.band);
    if (state.set !== 'all') p.set('set', state.set);
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.dir === -1) p.set('dir', 'desc');
    var s = p.toString();
    history.replaceState(null, '', (s ? '?' + s : location.pathname) + location.hash);
  }

  /* ---------- shared chrome ---------- */
  function optionList(values, current, counts) {
    return values.map(function (v) {
      var label = v.label + (counts ? ' (' + counts[v.value] + ')' : '');
      return '<option value="' + esc(v.value) + '"' + (v.value === current ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }
  function chainOptions() {
    var counts = {};
    R.rows.forEach(function (r) { r.chains.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    var names = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); });
    return [{ value: '', label: 'All chains' }].concat(names.map(function (n) { return { value: n, label: n }; }))
      .map(function (v) {
        var label = v.value ? v.label + ' (' + counts[v.value] + ')' : v.label;
        return '<option value="' + esc(v.value) + '"' + (v.value === state.chain ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('');
  }
  function catOptions() {
    var seen = {};
    R.rows.forEach(function (r) { seen[r.category === null ? '__none' : r.category] = true; });
    var names = Object.keys(seen).sort();
    var out = '<option value="">All categories</option>';
    names.forEach(function (n) {
      var label = n === '__none' ? 'Uncategorised' : n;
      out += '<option value="' + esc(n) + '"' + (n === state.cat ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    return out;
  }
  function modelCard() {
    var f = R.fitted, v = R.validation;
    var splits = v.splits.map(function (s) {
      return '<tr><td>' + esc(s.name) + '</td><td>' + s.test_size + '</td><td>' + s.log_rmse.toFixed(2) +
        '</td><td>' + s.median_ape_pct.toFixed(0) + '%</td><td>' + s.within_2x_pct.toFixed(0) + '%</td></tr>';
    }).join('');
    return '<section class="card"><h2>How the values are read</h2>' +
      '<p>A multiple is fitted, not asserted. The model regresses the market caps of the snapshot&rsquo;s own ' +
      f.calibration_size + ' token-bearing protocols on their size, growth, age and category, then reads every ' +
      'pre-token protocol through the fitted line:</p>' +
      '<p class="formula">ln(market cap) = ' + f.intercept.toFixed(3) + ' + ' + f.tvl_coef.toFixed(3) +
      ' &middot; ln(TVL) ' + (f.growth_coef < 0 ? '&minus;' : '+') + ' ' + Math.abs(f.growth_coef).toFixed(3) +
      ' &middot; 7d growth (clipped) ' + (f.age_coef < 0 ? '&minus;' : '+') + ' ' + Math.abs(f.age_coef).toFixed(3) +
      ' &middot; ln(1 + age in days) + category offset</p>' +
      '<table class="mini"><tr><th>Held-out split</th><th>Tested</th><th>Log RMSE</th><th>Median error</th><th>Within 2&times;</th></tr>' +
      splits + '</table>' +
      '<p class="small muted">Held out honestly, the fit is off by about 80% at the median and lands within twofold ' +
      'only a third of the time: on this data that is what there is. So every row carries the pooled interval, ' +
      '&times;' + v.interval_low_factor.toFixed(2) + ' to &times;' + v.interval_high_factor.toFixed(1) +
      ' around its point value. Read a value as an order of magnitude with a ranking attached, never as a price.</p></section>';
  }
  function liveCard() {
    var rows = R.live.map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.category || '—') + '</td>' +
        '<td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td>' +
        '<td class="num">' + pct(p.change_7d) + '</td></tr>';
    }).join('');
    return '<section class="card"><h2>Already trading, for scale</h2>' +
      '<p class="small muted">These protocols already have a token, so the market has priced them; they are not ' +
      'ranked and carry no farm plan. They are the yardstick the board above is read against.</p>' +
      '<table class="live"><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th>' +
      '<th class="num">Market cap</th><th class="num">7d</th></tr>' + rows + '</table></section>';
  }
  function footer() {
    foot.innerHTML =
      '<p>Snapshot: ' + esc(R.source) + '. Board built ' + esc(R.model_version) + ': ' + R.board_size +
      ' protocols ranked, covering all ' + R.watchlist_size + ' watchlist names plus ' + R.early_size + ' early finds.</p>' +
      '<p>An implied value is this board&rsquo;s own claim about what a token would be worth if the protocol&rsquo;s ' +
      'record stayed as it is. It is not a prediction that a token will be issued, and it is not advice.</p>';
  }

  /* ---------- the board ---------- */
  var COLS = [
    { key: 'rank', label: '#', num: true },
    { key: 'name', label: 'Protocol' },
    { key: null, label: 'Chains', cls: 'col-chains' },
    { key: 'tvl', label: 'TVL', num: true },
    { key: 'change', label: '7d', num: true },
    { key: 'value', label: 'Implied value', num: true },
    { key: null, label: 'Range', num: true },
    { key: 'multiple', label: '× TVL', num: true },
    { key: 'age', label: 'Age', num: true, cls: 'col-age' }
  ];
  function headHtml() {
    return COLS.map(function (c) {
      var cls = (c.num ? 'num ' : '') + (c.cls || '') + (c.key ? ' sortable' : '');
      var arrow = c.key && state.sort === c.key ? (state.dir === 1 ? ' ↑' : ' ↓') : '';
      return '<th class="' + cls.trim() + '"' + (c.key ? ' data-sort="' + c.key + '"' : '') + '>' + c.label + arrow + '</th>';
    }).join('');
  }
  function rowHtml(r) {
    var badge = r.watchlist ? '<span class="badge b-watch">Watchlist</span>' : '<span class="badge b-early">Early</span>';
    var ch = r.chains.length ? esc(r.chains[0]) + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') : '—';
    var chg = r.change_7d == null ? '—' : '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</span>';
    return '<tr tabindex="0" data-slug="' + esc(r.slug) + '">' +
      '<td class="num rank">' + r.rank + '</td>' +
      '<td><span class="pname">' + esc(r.name) + '</span>' + badge +
      '<span class="pcat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
      '<td class="chains col-chains">' + ch + '</td>' +
      '<td class="num">' + usd(r.tvl_usd) + '</td>' +
      '<td class="num">' + chg + '</td>' +
      '<td class="num value">' + usd(r.implied_value_usd) + '</td>' +
      '<td class="num range">' + usd(r.value_low_usd) + ' – ' + usd(r.value_high_usd) + '</td>' +
      '<td class="num">' + mult(r.multiple) + '</td>' +
      '<td class="num col-age">' + age(r.age_days) + '</td></tr>';
  }
  function renderTable() {
    var rows = sortedRows();
    var body = document.getElementById('tbody');
    var count = document.getElementById('count');
    var wrap = document.getElementById('boardwrap');
    if (!rows.length) {
      body.innerHTML = '';
      wrap.style.display = 'none';
      count.innerHTML = 'No protocols match these filters. <button type="button" id="reset">Clear the filters</button>';
      document.getElementById('reset').addEventListener('click', resetFilters);
      return;
    }
    wrap.style.display = '';
    count.innerHTML = 'Showing <b>' + rows.length + '</b> of ' + R.rows.length + ' ranked protocols' +
      (state.sort !== 'rank' ? ', sorted by ' + state.sort : '') + '. Select a row for its basis and farm plan.';
    body.innerHTML = rows.map(rowHtml).join('');
  }
  function resetFilters() {
    state = { q: '', chain: '', cat: '', band: '', set: 'all', sort: 'rank', dir: 1 };
    syncUrl();
    renderBoard();
  }
  function renderBoard() {
    sub.innerHTML = 'A snapshot of pre-token protocols, fetched ' + esc(R.as_of) + '. <b>' + R.board_size +
      ' ranked</b> &middot; ' + R.watchlist_size + ' watchlist &middot; ' + R.early_size + ' early finds &middot; values in USD';
    main.innerHTML = modelCard() +
      '<div class="controls">' +
      '<div><label for="q">Search</label><input type="search" id="q" placeholder="Name or slug" value="' + esc(state.q) + '"></div>' +
      '<div><label for="chain">Chain</label><select id="chain">' + chainOptions() + '</select></div>' +
      '<div><label for="cat">Category</label><select id="cat">' + catOptions() + '</select></div>' +
      '<div><label for="band">Value band</label><select id="band">' + optionList(BANDS.map(function (b) { return { value: b[0], label: b[1] }; }), state.band) + '</select></div>' +
      '<div><label for="set">Set</label><select id="set">' + optionList([
        { value: 'all', label: 'Whole board' }, { value: 'watch', label: 'Watchlist only' }, { value: 'early', label: 'Early finds only' }
      ], state.set) + '</select></div>' +
      '</div>' +
      '<p class="count" id="count"></p>' +
      '<div class="board-wrap" id="boardwrap"><table class="board"><thead><tr id="thead"></tr></thead>' +
      '<tbody id="tbody"></tbody></table></div>' +
      liveCard();
    document.getElementById('thead').innerHTML = headHtml();
    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; syncUrl(); renderTable(); });
    document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; syncUrl(); renderTable(); });
    document.getElementById('cat').addEventListener('change', function (e) { state.cat = e.target.value; syncUrl(); renderTable(); });
    document.getElementById('band').addEventListener('change', function (e) { state.band = e.target.value; syncUrl(); renderTable(); });
    document.getElementById('set').addEventListener('change', function (e) { state.set = e.target.value; syncUrl(); renderTable(); });
    document.getElementById('thead').addEventListener('click', function (e) {
      var th = e.target.closest('[data-sort]');
      if (!th) return;
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = (key === 'name' || key === 'rank') ? 1 : -1; }
      syncUrl();
      document.getElementById('thead').innerHTML = headHtml();
      renderTable();
    });
    document.getElementById('tbody').addEventListener('click', function (e) {
      var tr = e.target.closest('[data-slug]');
      if (tr) location.hash = '#/p/' + tr.getAttribute('data-slug');
    });
    document.getElementById('tbody').addEventListener('keydown', function (e) {
      var tr = e.target.closest('[data-slug]');
      if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); location.hash = '#/p/' + tr.getAttribute('data-slug'); }
    });
    renderTable();
    main.setAttribute('aria-busy', 'false');
  }

  /* ---------- one protocol ---------- */
  function stepHtml(step) {
    var at = step.indexOf(' Cost: ');
    if (at === -1) return '<li>' + esc(step) + '</li>';
    var action = step.slice(0, at);
    var rest = step.slice(at + 7);
    var tAt = rest.indexOf(' Time: ');
    var meta = tAt === -1 ? 'Cost: ' + rest
      : 'Cost: ' + rest.slice(0, tAt) + ' · Time: ' + rest.slice(tAt + 7);
    return '<li>' + esc(action) + '<span class="meta">' + esc(meta) + '</span></li>';
  }
  function totalsLine(steps) {
    var last = steps[steps.length - 1] || '';
    var m = last.match(/Plan total: about \$([\d,]+) of gas across roughly ([\d,]+) days, with \$([\d,]+) of capital/);
    if (!m) return '';
    return '<p class="totals">Plan total: <b>about $' + m[1] + ' of gas</b> across roughly <b>' + m[2] +
      ' days</b>, with <b>$' + m[3] + ' of capital</b> in the position. Every figure is itemised in the steps below.</p>';
  }
  function renderDetail(slug) {
    var r = null;
    R.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) { renderBoard(); return; }
    var lo = Math.log(r.value_low_usd), hi = Math.log(r.value_high_usd), pt = Math.log(r.implied_value_usd);
    var pos = hi > lo ? Math.max(0, Math.min(100, (pt - lo) / (hi - lo) * 100)) : 50;
    var badge = r.watchlist ? '<span class="badge b-watch">Watchlist</span>' : '<span class="badge b-early">Early find</span>';
    sub.innerHTML = 'Protocol detail &middot; rank <b>#' + r.rank + '</b> of ' + R.board_size;
    main.innerHTML =
      '<a class="back" href="#/">&larr; Back to the board</a>' +
      '<section class="card"><div class="dhead"><h2>' + esc(r.name) + badge + '</h2>' +
      '<p class="muted small">' + esc(r.category || 'Uncategorised') + ' &middot; ' + esc(r.slug) +
      ' &middot; tracked since ' + esc(r.listed_at || 'an unrecorded date') + '</p></div>' +
      '<p class="dvalue">' + fullUsd(r.implied_value_usd) + ' <span class="per">implied value, if it issued a token on this record</span></p>' +
      '<div class="rangebar"><div class="fill" style="left:0;width:100%"></div>' +
      '<div class="mark" style="left:calc(' + pos.toFixed(1) + '% - 2px)"></div></div>' +
      '<div class="rangelabels"><span>' + fullUsd(r.value_low_usd) + '</span><span>pooled held-out interval</span><span>' + fullUsd(r.value_high_usd) + '</span></div>' +
      '<dl class="facts">' +
      '<div><dt>Total value locked</dt><dd>' + fullUsd(r.tvl_usd) + '</dd></div>' +
      '<div><dt>Fitted multiple</dt><dd>' + mult(r.multiple) + ' of TVL</dd></div>' +
      '<div><dt>TVL change, 7 days</dt><dd>' + pct(r.change_7d) + ' (model reads ' + signed(r.growth_pct, 1) + '% after clipping)</dd></div>' +
      '<div><dt>Category offset</dt><dd>' + signed(r.category_offset, 2) + ' log units</dd></div>' +
      '<div><dt>Age on DefiLlama</dt><dd>' + (r.age_days == null ? '—' : commas(r.age_days) + ' days (' + age(r.age_days) + ')') + '</dd></div>' +
      '<div><dt>Chains</dt><dd>' + esc(r.chains.join(', ') || '—') + '</dd></div>' +
      '</dl>' +
      '<p class="small muted">The basis, in one line: the fitted model reads this protocol&rsquo;s TVL through a ' +
      mult(r.multiple) + ' multiple set by its size, its clipped 7-day growth, its age and a ' +
      esc(r.category || 'category') + ' offset of ' + signed(r.category_offset, 2) + '. The interval is the ' +
      'model&rsquo;s pooled held-out range, the same one every row carries.</p></section>' +
      '<section class="card"><h2>Farm plan</h2>' + totalsLine(r.farm_steps) +
      '<ol class="steps">' + r.farm_steps.map(stepHtml).join('') + '</ol>' +
      '<p class="small muted">Steps are written for the protocol&rsquo;s first chain and its size band. ' +
      'Costs are the plan&rsquo;s own estimates in USD; capital is the position itself, not a fee.</p></section>';
    window.scrollTo(0, 0);
    main.setAttribute('aria-busy', 'false');
  }

  /* ---------- routing ---------- */
  function route() {
    var m = location.hash.match(/^#\/p\/(.+)$/);
    if (m) renderDetail(decodeURIComponent(m[1]));
    else renderBoard();
  }
  window.addEventListener('hashchange', route);
  footer();
  route();
})();
