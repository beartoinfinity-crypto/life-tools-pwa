(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var loadedCount = 0;
  var allDraws = [];
  var totalCached = 0;

  // Base path this app is mounted at (hub server mounts it under /mark-six)
  var API_BASE = '/mark-six/api';

  var loadingEl = document.getElementById('loading');
  var errorEl = document.getElementById('error');
  var errorMsgEl = document.getElementById('errorMsg');
  var resultsEl = document.getElementById('results');
  var lastUpdateEl = document.getElementById('lastUpdate');
  var statusBarEl = document.getElementById('statusBar');
  var refreshBtn = document.getElementById('refreshBtn');
  var retryBtn = document.getElementById('retryBtn');
  var loadOlderWrap = document.getElementById('loadOlderWrap');
  var loadOlderBtn = document.getElementById('loadOlderBtn');
  var olderSpinner = document.getElementById('olderSpinner');
  var olderStatus = document.getElementById('olderStatus');

  var ndDateEl = document.getElementById('ndDate');
  var ndCutoffEl = document.getElementById('ndCutoff');
  var statsPanel = document.getElementById('statsPanel');
  var hotNumsEl = document.getElementById('hotNums');
  var coldNumsEl = document.getElementById('coldNums');
  var oeBarEl = document.getElementById('oeBar');
  var oeLegendEl = document.getElementById('oeLegend');
  var ticketInput = document.getElementById('ticketInput');
  var saveTicketBtn = document.getElementById('saveTicketBtn');
  var ticketErrorEl = document.getElementById('ticketError');
  var ticketListEl = document.getElementById('ticketList');

  function showLoading() {
    loadingEl.style.display = 'flex';
    errorEl.style.display = 'none';
    resultsEl.style.display = 'none';
    loadOlderWrap.style.display = 'none';
  }

  function showError(msg) {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'block';
    resultsEl.style.display = 'none';
    loadOlderWrap.style.display = 'none';
    errorMsgEl.textContent = msg;
  }

  function showResults() {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'none';
    resultsEl.style.display = 'block';
  }

  // Official Mark Six ball colours (numbers 1-49).
  var BALL_COLORS = {
    red: [1,2,7,8,12,13,18,19,23,24,29,30,34,35,40,45,46],
    blue: [3,4,9,10,14,15,20,25,26,31,32,36,37,41,42,47,48],
    green: [5,6,11,16,17,21,22,27,28,33,38,39,43,44,49]
  };
  var BALL_COLOR_CLASS = {};
  var BALL_COLOR_NAME = { red: 'Red', blue: 'Blue', green: 'Green' };
  Object.keys(BALL_COLORS).forEach(function (c) {
    BALL_COLORS[c].forEach(function (n) { BALL_COLOR_CLASS[n] = c; });
  });

  function ballColor(n) { return BALL_COLOR_CLASS[n] || 'red'; }

  function ballHtml(n, opts) {
    opts = opts || {};
    var color = ballColor(n);
    var cls = 'ball ball-' + color + (opts.sm ? ' sm' : '') + (opts.special ? ' special' : '');
    var label = (opts.special ? 'Special number ' + n + ' ' : n + ' ') + BALL_COLOR_NAME[color];
    return '<span class="' + cls + '" aria-label="' + label + '">' + n + '</span>';
  }

  function renderBalls(numbers, special) {
    var html = '<div class="winning-numbers" role="group" aria-label="Winning numbers">';
    numbers.forEach(function (n) { html += ballHtml(n); });
    if (special !== null && special !== undefined) {
      html += '<span class="divider" aria-hidden="true">+</span>' + ballHtml(special, { special: true });
    }
    html += '</div>';
    return html;
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

  /** "2026-09-08+08:00" -> { iso: "2026-09-08", text: "8 Sept 2026" } */
  function fmtDrawDate(drawDate) {
    var iso = String(drawDate || '').split('+')[0];
    var parts = iso.split('-');
    if (parts.length !== 3) return { iso: iso, text: iso };
    var day = parseInt(parts[2], 10);
    var month = MONTHS[parseInt(parts[1], 10) - 1] || '';
    return { iso: iso, text: (isNaN(day) ? parts[2] : day) + ' ' + month + ' ' + parts[0] };
  }

  function drawCardHTML(d) {
    var drawNum = d.id || '';
    var numbers = (d.drawResult && d.drawResult.drawnNo) || [];
    var special = d.drawResult ? d.drawResult.xDrawnNo : null;
    var date = fmtDrawDate(d.drawDate);
    var headingId = 'draw-heading-' + String(drawNum).replace(/[^A-Za-z0-9]/g, '-');

    return '<section class="draw-card" aria-labelledby="' + headingId + '">' +
      '<div class="draw-header">' +
        '<h2 class="draw-number" id="' + headingId + '">Draw Results - ' + drawNum + '</h2>' +
        '<time class="draw-date" datetime="' + date.iso + '">' + date.text + '</time>' +
      '</div>' +
      '<div class="draw-body">' +
        renderBalls(numbers, special) +
      '</div>' +
    '</section>';
  }

  function renderInitial(draws, total, src) {
    allDraws = draws;
    loadedCount = draws.length;
    totalCached = total;

    var html = '';
    draws.forEach(function (d) { html += drawCardHTML(d); });
    resultsEl.innerHTML = html;

    showResults();
    updateOlderUI(src);
    renderTickets();
  }

  function appendOlder(draws, total) {
    totalCached = total;
    var frag = document.createDocumentFragment();
    var tmp = document.createElement('div');
    draws.forEach(function (d) {
      tmp.innerHTML = drawCardHTML(d);
      frag.appendChild(tmp.firstChild);
      allDraws.push(d);
      loadedCount++;
    });
    resultsEl.appendChild(frag);
    updateOlderUI();
  }

  function updateOlderUI(src) {
    if (loadedCount >= totalCached) {
      loadOlderWrap.style.display = 'none';
    } else {
      loadOlderWrap.style.display = 'block';
      var remaining = totalCached - loadedCount;
      olderStatus.textContent = remaining + ' more available';
    }

    if (src) {
      statusBarEl.classList.add('fresh');
      lastUpdateEl.textContent = 'Loaded from ' + src + ' (' + totalCached + ' total)';
    }
  }

  async function loadInitial(forceRefresh) {
    showLoading();
    refreshBtn.classList.add('spinning');

    try {
      var url = forceRefresh ? API_BASE + '/marksix/refresh' : API_BASE + '/marksix';
      var resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastNDraw: PAGE_SIZE }),
        cache: 'no-store'
      });

      if (!resp.ok) throw new Error('Server returned ' + resp.status);

      var json = await resp.json();
      var draws = json.data && json.data.lotteryDraws;
      if (!draws || draws.length === 0) throw new Error('No results found');

      renderInitial(draws, json.totalCached || draws.length, json.source || 'unknown');
      drawSchedule = Array.isArray(json.drawSchedule) ? json.drawSchedule : [];
      tickCountdown(Date.now());
      lastRefreshDate = new Date();

    } catch (err) {
      showError(err.message || 'Failed to load results');
    } finally {
      refreshBtn.classList.remove('spinning');
    }
  }

  async function loadOlder() {
    loadOlderBtn.style.display = 'none';
    olderSpinner.style.display = 'inline-block';
    olderStatus.textContent = 'Loading...';

    try {
      var resp = await fetch(API_BASE + '/marksix/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: loadedCount + PAGE_SIZE }),
        cache: 'no-store'
      });

      if (!resp.ok) throw new Error('Server returned ' + resp.status);

      var json = await resp.json();
      var allDrawsReturned = json.data && json.data.lotteryDraws;
      if (!allDrawsReturned) throw new Error('No data');

      var newDraws = allDrawsReturned.slice(loadedCount);
      if (newDraws.length > 0) {
        appendOlder(newDraws, json.totalCached || allDrawsReturned.length);
      } else {
        updateOlderUI();
      }

    } catch (err) {
      olderStatus.textContent = 'Error: ' + err.message;
    } finally {
      loadOlderBtn.style.display = '';
      olderSpinner.style.display = 'none';
    }
  }

  // ---- next draw countdown ----
  // The authoritative source is HKJC's own published draw calendar, fetched
  // by the server and returned as drawSchedule (upcoming 'YYYY-MM-DD' dates).
  // Only when it is unavailable do we estimate: the cadence is normally
  // Tue/Thu/Sat, so the estimate is the first Tue/Thu/Sat after the newest
  // real draw. The real schedule skips draws around holidays and for
  // maintenance, so the estimate is a fallback, never the primary.
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var CUTOFF_UTC_HOURS = 13; // 21:15 HKT == 13:15 UTC (HKT has no DST)
  var drawSchedule = [];

  function isDrawDayUTC(day) { return day === 2 || day === 4 || day === 6; }

  function cutoffForDateIso(iso) {
    var p = String(iso).slice(0, 10).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2], CUTOFF_UTC_HOURS, 15, 0);
  }

  function makeTarget(iso, cutoff) {
    var p = String(iso).slice(0, 10).split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return { cutoffMs: cutoff, dateIso: iso, dayName: DAY_NAMES[d.getUTCDay()] };
  }

  function dateToUtcMs(iso) {
    var p = String(iso).slice(0, 10).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }

  /**
   * Next sales cutoff at/after nowMs.
   *   drawDates     - HKJC's published schedule (authoritative) when we have it
   *   latestDrawIso - newest real draw, used to anchor the fallback estimate
   * Returns null when nothing better than a guess is available.
   */
  function nextDrawCutoff(nowMs, drawDates, latestDrawIso) {
    if (drawDates && drawDates.length) {
      for (var i = 0; i < drawDates.length; i++) {
        var cutoff = cutoffForDateIso(drawDates[i]);
        if (cutoff > nowMs) return makeTarget(drawDates[i], cutoff);
      }
      return null; // schedule not published that far ahead yet
    }

    var hkt = new Date(nowMs + 8 * 3600 * 1000); // HKT calendar date via UTC getters
    var anchorIso = latestDrawIso ? String(latestDrawIso).slice(0, 10) : hkt.toISOString().slice(0, 10);
    var startOffset = latestDrawIso ? 1 : 0; // a same-day draw is only valid before any data lands

    for (var j = startOffset; j <= 8; j++) {
      var guess = new Date(dateToUtcMs(anchorIso) + j * 86400000);
      if (!isDrawDayUTC(guess.getUTCDay())) continue;
      var guessCut = Date.UTC(guess.getUTCFullYear(), guess.getUTCMonth(), guess.getUTCDate(), CUTOFF_UTC_HOURS, 15, 0);
      if (guessCut > nowMs) {
        return {
          cutoffMs: guessCut,
          dateIso: guess.toISOString().slice(0, 10),
          dayName: DAY_NAMES[guess.getUTCDay()]
        };
      }
    }
    return null;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function latestDrawIso() {
    var d = allDraws[0];
    return d && d.drawDate ? String(d.drawDate).slice(0, 10) : null;
  }

  var countdownTarget = null;  // the cutoff we are currently counting to
  var refreshInFlight = false; // one auto-refresh per expired target

  function tickCountdown(nowMs) {
    var next = nextDrawCutoff(nowMs, drawSchedule, latestDrawIso());
    if (!next) {
      if (ndDateEl) ndDateEl.textContent = 'Awaiting next draw date';
      if (ndCutoffEl) {
        ndCutoffEl.textContent = '--';
        ndCutoffEl.removeAttribute('datetime');
      }
      countdownTarget = null;
      return;
    }

    // The cutoff we were counting to has passed, so the draw has happened:
    // pull the fresh result once; the list re-anchors on the next tick.
    if (countdownTarget !== null && nowMs > countdownTarget && !refreshInFlight) {
      refreshInFlight = true;
      loadInitial(true).finally(function () { refreshInFlight = false; });
    }
    countdownTarget = next.cutoffMs;

    var totalSec = Math.floor((next.cutoffMs - nowMs) / 1000);
    var hrs = Math.floor(totalSec / 3600);
    var mins = Math.floor((totalSec % 3600) / 60);
    var secs = totalSec % 60;

    if (ndDateEl) ndDateEl.textContent = next.dateIso + ' (' + next.dayName + ')';
    if (ndCutoffEl) {
      ndCutoffEl.setAttribute('datetime', new Date(next.cutoffMs).toISOString());
      ndCutoffEl.textContent = pad2(hrs) + ' hrs : ' + pad2(mins) + ' mins : ' + pad2(secs) + ' secs';
    }
  }

  // ---- number frequency & hot/cold analytics ----
  var statsDraws = [];   // up to 100 newest draws (newest first)
  var statsWindow = 50;
  var STATS_WINDOWS = [20, 50, 100];

  function drawNumbers(d) {
    return (d && d.drawResult && d.drawResult.drawnNo) || [];
  }

  /**
   * Hot = most frequent in the window. Cold = absent from the window, ranked by
   * how many draws ago they last appeared in the fetched history (numbers never
   * seen in the fetch rank coldest). Odd/even = split over all drawn numbers in
   * the window.
   */
  function computeStats(draws, windowSize) {
    var win = draws.slice(0, windowSize);
    var counts = {}, i, j;
    for (i = 1; i <= 49; i++) counts[i] = 0;
    var odd = 0, even = 0;
    for (i = 0; i < win.length; i++) {
      var ns = drawNumbers(win[i]);
      for (j = 0; j < ns.length; j++) {
        counts[ns[j]]++;
        if (ns[j] % 2 === 1) odd++; else even++;
      }
    }

    var hot = [];
    for (i = 1; i <= 49; i++) if (counts[i] > 0) hot.push({ n: i, count: counts[i] });
    hot.sort(function (a, b) { return b.count - a.count || a.n - b.n; });
    hot = hot.slice(0, 6);

    function lastSeen(n) {
      for (var k = 0; k < draws.length; k++) {
        if (drawNumbers(draws[k]).indexOf(n) !== -1) return k;
      }
      return Infinity;
    }
    var cold = [];
    for (i = 1; i <= 49; i++) {
      if (counts[i] === 0) cold.push({ n: i, since: lastSeen(i) });
    }
    cold.sort(function (a, b) { return b.since - a.since || a.n - b.n; });
    cold = cold.slice(0, 6);

    return { hot: hot, cold: cold, odd: odd, even: even, windowSize: Math.min(windowSize, draws.length) };
  }

  function renderStats() {
    if (!statsDraws.length || !statsPanel) return;
    var s = computeStats(statsDraws, statsWindow);

    hotNumsEl.innerHTML = s.hot.map(function (h) {
      return '<span class="stat-entry">' + ballHtml(h.n, { sm: true }) +
        '<span class="stat-count">' + h.count + '\u00d7</span></span>';
    }).join('');

    coldNumsEl.innerHTML = s.cold.map(function (c) {
      var label = c.since === Infinity ? '>' + statsDraws.length : c.since;
      return '<span class="stat-entry">' + ballHtml(c.n, { sm: true }) +
        '<span class="stat-count">' + label + '</span></span>';
    }).join('');

    var total = s.odd + s.even;
    var oddPct = total ? Math.round((s.odd / total) * 100) : 0;
    var evenPct = total ? 100 - oddPct : 0;
    oeBarEl.innerHTML = '<span class="oe-odd" style="width:' + oddPct + '%"></span>' +
      '<span class="oe-even" style="width:' + evenPct + '%"></span>';
    oeBarEl.setAttribute('aria-label', s.odd + ' odd, ' + s.even + ' even across the last ' + s.windowSize + ' draws');
    oeLegendEl.textContent = s.odd + ' Odd (' + oddPct + '%) / ' + s.even + ' Even (' + evenPct + '%)';

    statsPanel.style.display = 'block';
  }

  // ---- shared draw history (stats + Smart Pick, persisted for offline) ----
  var HISTORY_KEY = 'm6_history';
  var MAX_STORED_DRAWS = 1000;
  var historyDraws = [];    // newest-first response-shaped draws, merged
  var historyRequested = 0; // largest /history limit already fetched

  function loadHistoryCache() {
    try {
      var a = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  function persistHistoryCache() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(historyDraws.slice(0, MAX_STORED_DRAWS)));
    } catch (e) {}
  }

  function mergeHistory(existing, incoming) {
    var combined = existing.concat(incoming || []);
    combined.sort(function (a, b) {
      return String(b.drawDate || '').localeCompare(String(a.drawDate || ''));
    });
    var seen = {}, out = [], i, d, key;
    for (i = 0; i < combined.length; i++) {
      d = combined[i];
      key = d.id || d.drawDate;
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(d);
      if (out.length >= MAX_STORED_DRAWS) break;
    }
    return out;
  }

  /** Newly fetched draws feed the store, the frequency panel and Smart Pick. */
  function applyHistory(draws) {
    historyDraws = mergeHistory(historyDraws, draws);
    statsDraws = historyDraws;
    persistHistoryCache();
    if (statsDraws.length) renderStats();
    scheduleBacktest();
  }

  async function fetchStats() {
    try {
      var resp = await fetch(API_BASE + '/marksix/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100 }),
        cache: 'no-store'
      });
      if (!resp.ok) throw new Error('Server returned ' + resp.status);
      var json = await resp.json();
      var draws = json.data && json.data.lotteryDraws;
      if (!draws || !draws.length) throw new Error('No data');
      historyRequested = 100;
      applyHistory(draws);
    } catch (e) {
      // stats are best-effort; keep the panel hidden when history is unavailable
      if (!statsDraws.length && statsPanel) statsPanel.style.display = 'none';
      scheduleBacktest(); // locally stored history may still feed Smart Pick
    }
  }

  // ---- Smart Pick generator (prediction engine over stored history) ----
  var strategySelect = document.getElementById('strategySelect');
  var historySelect = document.getElementById('historySelect');
  var sumRangeChk = document.getElementById('sumRangeChk');
  var consecutiveChk = document.getElementById('consecutiveChk');
  var generateBtn = document.getElementById('generateBtn');
  var generate5Btn = document.getElementById('generate5Btn');
  var backtestBadge = document.getElementById('backtestBadge');
  var smartStatus = document.getElementById('smartStatus');
  var smartLines = document.getElementById('smartLines');
  var backtestTimer = null;
  var historyNote = ''; // set when a deeper-history fetch fails; survives status updates

  function showSmartStatus(msg) {
    if (!smartStatus) return;
    smartStatus.textContent = msg || '';
    smartStatus.hidden = !msg;
  }

  function engineHistory() {
    return historyDraws.map(function (d) { return window.MarksixEngine.normalizeDraw(d); });
  }

  function targetHistoryLimit() {
    if (!historySelect) return 100;
    if (historySelect.value === 'all') return Math.max(totalCached || 0, MAX_STORED_DRAWS);
    return parseInt(historySelect.value, 10) || 100;
  }

  /** Fetch a deeper history when the selected window is wider than what we hold. */
  async function ensureHistory() {
    var limit = targetHistoryLimit();
    if (historyRequested >= limit && historyDraws.length) return historyDraws;
    try {
      var resp = await fetch(API_BASE + '/marksix/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: limit }),
        cache: 'no-store'
      });
      if (!resp.ok) throw new Error('Server returned ' + resp.status);
      var json = await resp.json();
      var draws = json.data && json.data.lotteryDraws;
      if (draws && draws.length) {
        historyRequested = Math.max(historyRequested, limit);
        applyHistory(draws);
      }
      historyNote = '';
      return historyDraws;
    } catch (e) {
      historyNote = 'History unavailable - using stored draws.';
      showSmartStatus(historyNote);
      return historyDraws;
    }
  }

  function currentEngineConfig() {
    var oe = document.querySelector('input[name="oeRatio"]:checked');
    return {
      historyLimit: historySelect && historySelect.value === 'all'
        ? null
        : (parseInt(historySelect ? historySelect.value : '100', 10) || 100),
      sumRange: sumRangeChk && sumRangeChk.checked ? [140, 210] : null,
      oddEvenRatio: oe ? oe.value : 'balanced',
      consecutivePairProb: !!(consecutiveChk && consecutiveChk.checked),
      iterations: 10000
    };
  }

  /**
   * Run the engine, offloading to the Web Worker when the spec thresholds
   * hit: more than 500 draws analysed, or Monte Carlo above 10,000 loops.
   */
  function runEngine(mode, strategy, draws, config, backtestOpts) {
    var Engine = window.MarksixEngine;
    var heavy = draws.length > 500 || (strategy === 'monte_carlo' && config.iterations > 10000);
    if (typeof Worker === 'undefined' || !heavy) {
      if (mode === 'backtest') {
        return Promise.resolve({ backtest: Engine.backtest(strategy, draws, config, backtestOpts) });
      }
      return Promise.resolve({ result: Engine.generatePick(strategy, draws, config) });
    }
    return new Promise(function (resolve, reject) {
      var worker = new Worker('prediction-worker.js');
      var timer = setTimeout(function () {
        worker.terminate();
        reject(new Error('Calculation timed out'));
      }, 10000);
      worker.onmessage = function (e) {
        clearTimeout(timer);
        worker.terminate();
        if (e.data && e.data.ok) resolve(e.data);
        else reject(new Error((e.data && e.data.error) || 'Engine failed'));
      };
      worker.onerror = function () {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error('Engine failed'));
      };
      worker.postMessage({
        id: Date.now(),
        strategy: strategy,
        draws: draws,
        config: config,
        wantBacktest: mode === 'backtest',
        backtestOpts: backtestOpts || null
      });
    });
  }

  function renderSmartLines(picks) {
    if (!smartLines) return;
    var html = '', i, j, p, balls;
    for (i = 0; i < picks.length; i++) {
      p = picks[i];
      balls = '';
      for (j = 0; j < p.numbers.length; j++) balls += ballHtml(p.numbers[j], { sm: true });
      html += '<div class="smart-line">' +
        '<div class="smart-line-head">' +
          '<span class="smart-line-label">Generated Line ' + (i + 1) + '</span>' +
          '<span class="smart-score">Score: ' + p.score + '%</span>' +
        '</div>' +
        '<div class="ticket-balls" role="group" aria-label="Generated line ' + (i + 1) + ' numbers">' + balls + '</div>' +
        '<div class="smart-breakdown">Breakdown: Sum ' + p.breakdown.sum +
          ' | ' + p.breakdown.oddEven +
          ' | ' + p.breakdown.hotCount + ' Hot / ' + p.breakdown.coldCount + ' Cold</div>' +
      '</div>';
    }
    smartLines.innerHTML = html;
  }

  function reportDegraded(picks) {
    var seen = {}, notes = [];
    picks.forEach(function (p) {
      if (!p.degraded || seen[p.degraded]) return;
      seen[p.degraded] = true;
      if (p.degraded === 'no_history') notes.push('No stored history yet - numbers are random.');
      else if (p.degraded === 'short_history') notes.push('Under 10 stored draws - predictions are weak.');
      else if (p.degraded === 'gates_relaxed') notes.push('A filter was too tight and was relaxed.');
    });
    // degradation notes win, but never wipe the offline/history note
    showSmartStatus(notes.join(' ') || historyNote);
  }

  async function generateSmartLines(count) {
    showSmartStatus(historyNote);
    if (!window.MarksixEngine) {
      showSmartStatus('Prediction engine unavailable.');
      return;
    }
    if (generateBtn) generateBtn.disabled = true;
    if (generate5Btn) generate5Btn.disabled = true;
    try {
      await ensureHistory();
      var cfg = currentEngineConfig();
      var strategy = strategySelect ? strategySelect.value : 'balanced';
      var draws = engineHistory();
      var picks = [], i, out;
      for (i = 0; i < count; i++) {
        out = await runEngine('generate', strategy, draws, cfg);
        picks.push(out.result);
      }
      renderSmartLines(picks);
      reportDegraded(picks);
    } catch (e) {
      showSmartStatus('Could not generate: ' + (e.message || e));
    } finally {
      if (generateBtn) generateBtn.disabled = false;
      if (generate5Btn) generate5Btn.disabled = false;
    }
  }

  function scheduleBacktest() {
    if (!backtestBadge) return;
    if (backtestTimer) clearTimeout(backtestTimer);
    backtestTimer = setTimeout(function () {
      backtestTimer = null;
      runBacktest();
    }, 250);
  }

  async function runBacktest() {
    if (!backtestBadge || !window.MarksixEngine) return;
    backtestBadge.hidden = false;
    backtestBadge.textContent = 'Computing backtest...';
    var cfg = currentEngineConfig();
    if (strategySelect && strategySelect.value === 'monte_carlo') cfg.iterations = 1000; // keep badges quick
    try {
      var draws = engineHistory();
      var strategy = strategySelect ? strategySelect.value : 'balanced';
      var out = await runEngine('backtest', strategy, draws, cfg, { window: 20, minHits: 3 });
      var bt = out.backtest;
      backtestBadge.textContent = bt.evaluated
        ? 'Strategy hit rate (3+ numbers): ' + bt.hitRate + '% in last ' +
          bt.evaluated + (bt.evaluated === 1 ? ' draw' : ' draws') + '.'
        : 'Backtest needs 11+ draws of history.';
    } catch (e) {
      backtestBadge.textContent = 'Backtest unavailable.';
    }
  }

  // ---- ticket checker (localStorage saved_tickets) ----
  var TICKETS_KEY = 'saved_tickets';

  function loadTickets() {
    try {
      var a = JSON.parse(localStorage.getItem(TICKETS_KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  function persistTickets(list) {
    try { localStorage.setItem(TICKETS_KEY, JSON.stringify(list)); } catch (e) {}
  }

  /** Parse "3 7 11 15 33 46" (space/comma separated) into 6 unique ints 1-49. */
  function parseTicketNumbers(input) {
    var parts = String(input || '').split(/[\s,;]+/).filter(function (s) { return s.length; });
    if (parts.length !== 6) return { ok: false, error: 'Enter exactly 6 numbers (1-49).' };
    var nums = [], i;
    for (i = 0; i < parts.length; i++) {
      if (!/^\d{1,2}$/.test(parts[i])) return { ok: false, error: 'Numbers must be whole numbers from 1 to 49.' };
      var v = parseInt(parts[i], 10);
      if (v < 1 || v > 49) return { ok: false, error: 'Numbers must be from 1 to 49.' };
      if (nums.indexOf(v) !== -1) return { ok: false, error: 'Duplicates are not allowed.' };
      nums.push(v);
    }
    nums.sort(function (a, b) { return a - b; });
    return { ok: true, numbers: nums };
  }

  /** Prize division (1-7) per the HKJC matrix, or 0 for no prize. */
  function checkTicket(numbers, drawn, special) {
    var hit = 0, i;
    for (i = 0; i < numbers.length; i++) if (drawn.indexOf(numbers[i]) !== -1) hit++;
    var specialHit = special !== null && special !== undefined && numbers.indexOf(special) !== -1;
    if (hit === 6) return 1;
    if (hit === 5) return specialHit ? 2 : 3;
    if (hit === 4) return specialHit ? 4 : 5;
    if (hit === 3) return specialHit ? 6 : 7;
    return 0;
  }

  function divisionLabel(div) {
    if (div <= 0) return 'No prize';
    return ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'][div - 1] + ' Division';
  }

  function nextTicketId(list) {
    var d = new Date();
    var stamp = d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate());
    var prefix = 't_' + stamp + '_';
    var seq = 0;
    list.forEach(function (t) {
      if (String(t.id).indexOf(prefix) === 0) seq++;
    });
    return prefix + pad2(seq + 1);
  }

  function renderTickets() {
    if (!ticketListEl) return;
    var list = loadTickets();
    if (!list.length) {
      ticketListEl.innerHTML = '<p class="ticket-empty">No saved tickets yet.</p>';
      return;
    }
    var latest = allDraws[0];
    var drawn = drawNumbers(latest);
    var special = latest && latest.drawResult ? latest.drawResult.xDrawnNo : null;

    ticketListEl.innerHTML = list.map(function (t) {
      var div = latest ? checkTicket(t.numbers, drawn, special) : null;
      var badge = div === null
        ? '<span class="ticket-badge pending">Pending</span>'
        : '<span class="ticket-badge div-' + div + (div === 0 ? ' none' : '') + '">' + divisionLabel(div) + '</span>';
      var balls = t.numbers.map(function (n) { return ballHtml(n, { sm: true }); }).join('');
      return '<div class="ticket-row" data-id="' + t.id + '">' +
        '<div class="ticket-balls" role="group" aria-label="Ticket numbers">' + balls + '</div>' +
        badge +
        '<button type="button" class="ticket-del" data-id="' + t.id + '" aria-label="Delete ticket ' + t.id + '">&times;</button>' +
      '</div>';
    }).join('');
  }

  function showTicketError(msg) {
    if (!ticketErrorEl) return;
    ticketErrorEl.textContent = msg;
    ticketErrorEl.hidden = !msg;
  }

  function saveTicket() {
    var parsed = parseTicketNumbers(ticketInput.value);
    if (!parsed.ok) { showTicketError(parsed.error); return; }
    showTicketError('');
    var list = loadTickets();
    list.unshift({
      id: nextTicketId(list),
      numbers: parsed.numbers,
      type: 'single',
      created_at: new Date().toISOString()
    });
    persistTickets(list);
    ticketInput.value = '';
    renderTickets();
  }

  var lastRefreshDate = null;

  function isPastMidnight() {
    var now = new Date();
    if (!lastRefreshDate) return true;
    return now.toDateString() !== lastRefreshDate.toDateString();
  }

  function scheduleMidnightRefresh() {
    var now = new Date();
    var midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    var msUntilMidnight = midnight - now;
    setTimeout(function () {
      if (isScheduledDrawDay(new Date())) loadInitial(true);
      scheduleMidnightRefresh();
    }, msUntilMidnight);
  }

  /**
   * True when `now` falls on a draw day in Hong Kong: the official schedule
   * when we have it, otherwise the classic Tue/Thu/Sat rule.
   */
  function isScheduledDrawDay(now) {
    var hkt = new Date(now.getTime() + 8 * 3600 * 1000); // UTC fields = HKT calendar
    var iso = hkt.toISOString().slice(0, 10);
    if (drawSchedule.length) return drawSchedule.indexOf(iso) !== -1;
    var day = hkt.getUTCDay();
    return day === 2 || day === 4 || day === 6;
  }

  refreshBtn.addEventListener('click', function () { loadInitial(true); });
  retryBtn.addEventListener('click', function () { loadInitial(true); });
  loadOlderBtn.addEventListener('click', loadOlder);

  if (generateBtn) generateBtn.addEventListener('click', function () { generateSmartLines(1); });
  if (generate5Btn) generate5Btn.addEventListener('click', function () { generateSmartLines(5); });
  if (strategySelect) strategySelect.addEventListener('change', scheduleBacktest);
  if (historySelect) {
    historySelect.addEventListener('change', function () {
      ensureHistory().then(function () { scheduleBacktest(); });
    });
  }
  [sumRangeChk, consecutiveChk].forEach(function (el) {
    if (el) el.addEventListener('change', scheduleBacktest);
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="oeRatio"]'), function (el) {
    el.addEventListener('change', scheduleBacktest);
  });

  saveTicketBtn.addEventListener('click', saveTicket);
  ticketInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); saveTicket(); }
  });
  ticketInput.addEventListener('input', function () { showTicketError(''); });
  ticketListEl.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.ticket-del') : null;
    if (!b) return;
    var id = b.getAttribute('data-id');
    persistTickets(loadTickets().filter(function (t) { return t.id !== id; }));
    renderTickets();
  });

  var statsChipsEl = document.getElementById('statsChips');
  if (statsChipsEl) {
    statsChipsEl.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.stats-chip') : null;
      if (!b) return;
      statsWindow = parseInt(b.getAttribute('data-w'), 10) || 50;
      Array.prototype.forEach.call(statsChipsEl.querySelectorAll('.stats-chip'), function (c) {
        var on = c === b;
        c.classList.toggle('active', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      renderStats();
    });
  }

  // Boot: cache-first read (documented behaviour - no scraping on page load);
  // the refresh button, the draw-day midnight schedule and the countdown
  // expiry (to pick up a draw that just happened) still force one.
  // Stored history seeds stats and Smart Pick before any network answer, so
  // both keep working offline.
  historyDraws = loadHistoryCache();
  if (historyDraws.length) {
    statsDraws = historyDraws;
    renderStats();
    scheduleBacktest();
  }
  tickCountdown(Date.now());
  setInterval(function () { tickCountdown(Date.now()); }, 1000);
  loadInitial(false);
  fetchStats();
  scheduleMidnightRefresh();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }

  /* ---- PWA install banner (shares the hub's dismiss key) ---- */
  var INSTALL_DISMISS_KEY = 'life-tool-install-dismissed';
  var deferredPrompt = null;
  var installBanner = document.createElement('div');
  installBanner.className = 'install-banner';
  installBanner.style.display = 'none';
  installBanner.setAttribute('role', 'region');
  installBanner.setAttribute('aria-label', 'Install app');
  installBanner.innerHTML =
    '<p>Add Mark Six to your home screen?</p>' +
    '<button class="install-btn" type="button">Install</button>' +
    '<button class="dismiss-btn" type="button" aria-label="Dismiss">&times;</button>';
  document.body.insertBefore(installBanner, document.body.firstChild);

  function bannerDismissed() { try { return sessionStorage.getItem(INSTALL_DISMISS_KEY) === '1'; } catch (e) { return false; } }
  function markBannerDismissed() { try { sessionStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch (e) {} }

  function isInstalledMode() {
    if (navigator.standalone === true) return true; // iOS Safari, launched from the home screen
    var dm = window.matchMedia && window.matchMedia('(display-mode: standalone)');
    return !!(dm && dm.matches);
  }

  var BANNER_AUTO_DISMISS_MS = (function () {
    var v = Number(window.__BANNER_AUTO_DISMISS_MS);
    return isFinite(v) && v > 0 ? v : 10000;
  })();
  var bannerAutoDismissTimer = null;

  function armBannerAutoDismiss() {
    if (bannerAutoDismissTimer) window.clearTimeout(bannerAutoDismissTimer);
    bannerAutoDismissTimer = window.setTimeout(function () {
      bannerAutoDismissTimer = null;
      markBannerDismissed();
      closeInstallBanner();
    }, BANNER_AUTO_DISMISS_MS);
  }

  function cancelBannerAutoDismiss() {
    if (bannerAutoDismissTimer) {
      window.clearTimeout(bannerAutoDismissTimer);
      bannerAutoDismissTimer = null;
    }
  }

  function openInstallBanner() {
    installBanner.style.display = 'flex';
    armBannerAutoDismiss();
  }
  function closeInstallBanner() {
    cancelBannerAutoDismiss();
    installBanner.style.display = 'none';
  }

  var bannerP = installBanner.querySelector('p');
  var bannerBtn = installBanner.querySelector('.install-btn');
  var currentBannerMode = 'install';
  var BANNER_TEXTS = {
    install: { text: 'Add Mark Six to your home screen?', btn: 'Install' },
    ios: { text: 'Tap the Share button, then choose "Add to Home Screen".', btn: '' },
    manual: { text: 'Open your browser menu and choose "Install app" or "Add to Home Screen".', btn: '' }
  };

  function isIOS() {
    var ua = navigator.userAgent || '';
    if (/iP(hone|ad|od)\b/.test(ua)) return true;
    return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
  }

  function setBannerMode(mode) {
    var t = BANNER_TEXTS[mode];
    if (!t) return;
    currentBannerMode = mode;
    bannerP.textContent = t.text;
    bannerBtn.textContent = t.btn;
    bannerBtn.style.display = t.btn ? '' : 'none';
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    if (isInstalledMode()) return;
    deferredPrompt = e;
    setBannerMode('install');
    if (!bannerDismissed()) openInstallBanner();
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    closeInstallBanner();
  });

  if (isIOS() && !isInstalledMode() && !bannerDismissed()) {
    setBannerMode('ios');
    openInstallBanner();
  }

  installBanner.querySelector('.install-btn').addEventListener('click', function () {
    var pe = deferredPrompt;
    deferredPrompt = null;
    if (pe && typeof pe.prompt === 'function') {
      try { pe.prompt(); } catch (e) {}
      if (pe.userChoice && typeof pe.userChoice.then === 'function') {
        pe.userChoice.then(function () { markBannerDismissed(); closeInstallBanner(); },
                           function () { closeInstallBanner(); });
      } else { closeInstallBanner(); }
    } else {
      setBannerMode('manual');
      openInstallBanner();
    }
  });
  installBanner.querySelector('.dismiss-btn').addEventListener('click', function () {
    markBannerDismissed();
    closeInstallBanner();
  });

  // Pure-logic test hooks (no DOM dependency).
  window.MarksixCore = {
    ballColor: ballColor,
    parseTicketNumbers: parseTicketNumbers,
    checkTicket: checkTicket,
    divisionLabel: divisionLabel,
    nextDrawCutoff: nextDrawCutoff,
    computeStats: computeStats,
    fmtDrawDate: fmtDrawDate,
    tickCountdown: tickCountdown,
    generateSmartLines: generateSmartLines,
    runBacktest: runBacktest,
    isScheduledDrawDay: isScheduledDrawDay,
    historyCount: function () { return historyDraws.length; }
  };
})();
