(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var loadedCount = 0;
  var allDraws = [];
  var totalCached = 0;

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

  var BALL_COLORS = {
    red: [1,2,7,8,12,13,18,19,23,24,29,30,34,35,40,45,46],
    blue: [3,4,9,10,14,15,20,25,26,31,36,37,41,42,47,48],
    green: [5,6,11,16,17,21,22,27,28,32,33,38,39,43,44,49]
  };
  var BALL_COLOR_CLASS = {};
  Object.keys(BALL_COLORS).forEach(function (c) {
    BALL_COLORS[c].forEach(function (n) { BALL_COLOR_CLASS[n] = c; });
  });

  function renderBalls(numbers, special) {
    var html = '<div class="numbers-row">';
    numbers.forEach(function (n) {
      var num = String(n).padStart(2, '0');
      var color = BALL_COLOR_CLASS[n] || '';
      html += '<div class="number-ball ' + color + '">' + num + '</div>';
    });
    if (special !== null && special !== undefined) {
      var snum = String(special).padStart(2, '0');
      var sColor = BALL_COLOR_CLASS[special] || '';
      html += '<div class="special-wrap"><span class="special-plus">+</span><div class="number-ball special ' + sColor + '">' + snum + '</div></div>';
    }
    html += '</div>';
    return html;
  }

  function drawCardHTML(d) {
    var dateStr = d.drawDate || '';
    var drawNum = d.id || '';
    var numbers = (d.drawResult && d.drawResult.drawnNo) || [];
    var special = d.drawResult ? d.drawResult.xDrawnNo : null;

    return '<div class="draw-card">' +
      '<div class="draw-header">' +
        '<span class="draw-number">Draw #' + drawNum + '</span>' +
        '<span class="draw-date">' + dateStr + '</span>' +
      '</div>' +
      '<div class="draw-body">' +
        renderBalls(numbers, special) +
      '</div>' +
    '</div>';
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
      var url = forceRefresh ? '/api/marksix/refresh' : '/api/marksix';
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
      var resp = await fetch('/api/marksix/history', {
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
      loadInitial(true);
      scheduleMidnightRefresh();
    }, msUntilMidnight);
  }

  refreshBtn.addEventListener('click', function () { loadInitial(true); });
  retryBtn.addEventListener('click', function () { loadInitial(true); });
  loadOlderBtn.addEventListener('click', loadOlder);

  loadInitial(isPastMidnight());
  scheduleMidnightRefresh();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }

  var deferredPrompt = null;
  var installBanner = document.createElement('div');
  installBanner.className = 'install-banner';
  installBanner.style.display = 'none';
  installBanner.innerHTML =
    '<p>Add Mark Six to your home screen?</p>' +
    '<button class="install-btn" id="installBtn">Install</button>' +
    '<button class="dismiss-btn" id="dismissBtn">&times;</button>';

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    document.body.insertBefore(installBanner, document.body.firstChild.nextSibling);
    installBanner.style.display = 'flex';

    document.getElementById('installBtn').addEventListener('click', function () {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        deferredPrompt = null;
        installBanner.style.display = 'none';
      });
    });

    document.getElementById('dismissBtn').addEventListener('click', function () {
      installBanner.style.display = 'none';
    });
  });
})();
