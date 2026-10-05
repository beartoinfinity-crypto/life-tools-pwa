/**
 * Mark Six prediction engine - pure, DOM-free calculations over past draws.
 *
 * Runs in the browser, inside a Web Worker (via importScripts), and under
 * CommonJS tests. Input draws are newest-first:
 *   { drawNo, date, numbers: number[6], extraNumber }
 *
 * Nothing here is a prediction guarantee: the strategies are heuristics over
 * historical frequency, recency, gaps and transitions. The draw is random.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (root) { root.MarksixEngine = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NUMBERS = 49;
  var PICK = 6;
  var MIN_HISTORY = 10;
  var REJECTION_ATTEMPTS = 400;
  var HOT_HALF_LIFE = 30;       // hot_streak decay: W(t) = e^(-lambda*t)
  var HOT_LAMBDA = Math.log(2) / HOT_HALF_LIFE;
  var MIN_SIGMA = 0.5;          // avoids divide-by-zero in cold_recovery
  var MAX_Z = 10;
  var PATTERN_RETRY_ATTEMPTS = 30; // contrarian: bounded retries for a clean ticket

  var STRATEGIES = ['balanced', 'hot_streak', 'cold_recovery', 'monte_carlo', 'markov_chain', 'contrarian'];

  var DEFAULT_CONFIG = {
    historyLimit: 100,
    sumRange: [140, 210],
    oddEvenRatio: 'balanced',   // 'any' | 'balanced' | 'odd_heavy' | 'even_heavy'
    consecutivePairProb: false,
    iterations: 10000           // monte_carlo only
  };

  var GATE_CONSEC = 1;
  var GATE_ODD = 2;
  var GATE_SUM = 4;
  // exclusion masks tried fewest-first so only what is impossible gets dropped
  var TIER_ORDER = [0, 1, 2, 4, 3, 5, 6, 7];
  var ALL_ORDER = (function () {
    var o = [], i;
    for (i = 1; i <= 49; i++) o.push(i);
    return o;
  })();

  function mergeConfig(cfg) {
    var out = {}, k;
    for (k in DEFAULT_CONFIG) if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, k)) out[k] = DEFAULT_CONFIG[k];
    if (cfg) for (k in cfg) if (Object.prototype.hasOwnProperty.call(cfg, k)) out[k] = cfg[k];
    if (!(out.historyLimit > 0)) out.historyLimit = null; // null/Infinity => all draws
    if (!(out.iterations > 0)) out.iterations = DEFAULT_CONFIG.iterations;
    return out;
  }

  function sortAsc(a, b) { return a - b; }

  function validNumbers(d) {
    var raw = (d && d.numbers) || [];
    var out = [], i, n;
    for (i = 0; i < raw.length; i++) {
      n = raw[i];
      if (Number.isInteger(n) && n >= 1 && n <= NUMBERS) out.push(n);
    }
    return out;
  }

  function normalizeDraw(d) {
    var result = (d && d.drawResult) || {};
    var numbers = result.drawnNo;
    return {
      drawNo: d && d.id,
      date: String((d && d.drawDate) || '').slice(0, 10),
      numbers: Array.isArray(numbers) ? numbers.slice() : [],
      extraNumber: result.xDrawnNo == null ? null : result.xDrawnNo
    };
  }

  function windowOf(draws, cfg) {
    var all = Array.isArray(draws) ? draws : [];
    if (cfg.historyLimit == null) return all.slice();
    return all.slice(0, cfg.historyLimit);
  }

  // ---- stats ----

  function frequencyMap(draws, limit) {
    var counts = [], i, j, n, nums;
    for (i = 0; i <= NUMBERS; i++) counts[i] = 0;
    var list = Array.isArray(draws) ? draws : [];
    var take = limit == null ? list.length : Math.min(limit, list.length);
    for (i = 0; i < take; i++) {
      nums = validNumbers(list[i]);
      for (j = 0; j < nums.length; j++) counts[nums[j]]++;
    }
    return counts;
  }

  function gapMap(draws) {
    var gaps = [], i, j, n, nums;
    for (i = 0; i <= NUMBERS; i++) gaps[i] = Infinity;
    var list = Array.isArray(draws) ? draws : [];
    for (i = 0; i < list.length; i++) {
      nums = validNumbers(list[i]);
      for (j = 0; j < nums.length; j++) {
        n = nums[j];
        if (gaps[n] === Infinity) gaps[n] = i;
      }
    }
    return gaps;
  }

  function mean(values) {
    if (!values.length) return 0;
    var s = 0, i;
    for (i = 0; i < values.length; i++) s += values[i];
    return s / values.length;
  }

  function stddev(values) {
    if (values.length < 2) return 0;
    var m = mean(values), s = 0, i, d;
    for (i = 0; i < values.length; i++) { d = values[i] - m; s += d * d; }
    return Math.sqrt(s / values.length);
  }

  // ---- gates ----

  function oddCount(nums) {
    var c = 0, i;
    for (i = 0; i < nums.length; i++) if (nums[i] % 2 === 1) c++;
    return c;
  }

  function sumOf(nums) {
    var s = 0, i;
    for (i = 0; i < nums.length; i++) s += nums[i];
    return s;
  }

  function hasConsecutive(nums) {
    var i;
    for (i = 1; i < nums.length; i++) if (nums[i] === nums[i - 1] + 1) return true;
    return false;
  }

  function oddInRange(c, ratio) {
    if (ratio === 'odd_heavy') return c >= 3 && c <= 5;
    if (ratio === 'even_heavy') return c >= 1 && c <= 3;
    if (ratio === 'balanced') return c >= 2 && c <= 4;
    return true; // 'any'
  }

  function activeGates(cfg) {
    var g = 0;
    if (cfg.consecutivePairProb) g |= GATE_CONSEC;
    if (cfg.oddEvenRatio && cfg.oddEvenRatio !== 'any') g |= GATE_ODD;
    if (cfg.sumRange && cfg.sumRange.length === 2) g |= GATE_SUM;
    return g;
  }

  function gatePass(nums, cfg, checkMask) {
    if (checkMask & GATE_CONSEC) { if (!hasConsecutive(nums)) return false; }
    if (checkMask & GATE_ODD) { if (!oddInRange(oddCount(nums), cfg.oddEvenRatio)) return false; }
    if (checkMask & GATE_SUM) {
      var s = sumOf(nums);
      if (s < cfg.sumRange[0] || s > cfg.sumRange[1]) return false;
    }
    return true;
  }

  function swapRepair(nums, cfg, mask, poolOrder) {
    var i, j, v, cand;
    for (i = 0; i < nums.length; i++) {
      for (j = 0; j < poolOrder.length; j++) {
        v = poolOrder[j];
        if (nums.indexOf(v) !== -1) continue;
        cand = nums.slice();
        cand[i] = v;
        cand.sort(sortAsc);
        if (gatePass(cand, cfg, mask)) return cand;
      }
    }
    return null;
  }

  /**
   * Walk the candidate towards the sum range by swapping its extreme numbers
   * for the best available pool values (used when a strategy's top picks sit
   * far outside the range, which no single swap can fix).
   */
  function normalizeSum(nums, cfg, poolOrder) {
    if (!cfg.sumRange || cfg.sumRange.length !== 2) return null;
    var lo = cfg.sumRange[0], hi = cfg.sumRange[1];
    var cand = nums.slice(), guard, i, best, s, edge, v;

    for (guard = 0; guard < 8; guard++) {
      s = sumOf(cand);
      if (s >= lo && s <= hi) return cand.sort(sortAsc);
      cand.sort(sortAsc);
      if (s < lo) {
        edge = cand[0];
        best = null;
        for (i = 0; i < poolOrder.length; i++) {
          v = poolOrder[i];
          if (cand.indexOf(v) !== -1) continue;
          if (best === null || v > best) best = v;
        }
        if (best === null || best <= edge) return null;
        cand[cand.indexOf(edge)] = best;
      } else {
        edge = cand[cand.length - 1];
        best = null;
        for (i = 0; i < poolOrder.length; i++) {
          v = poolOrder[i];
          if (cand.indexOf(v) !== -1) continue;
          if (best === null || v < best) best = v;
        }
        if (best === null || best >= edge) return null;
        cand[cand.indexOf(edge)] = best;
      }
    }
    return null;
  }

  /**
   * Get a candidate through the gates: full pass, else repair (single swaps,
   * then sum normalisation), else relax gates fewest-first - repairing again
   * under each relaxed mask so only gates that are truly impossible drop.
   */
  function resolveCandidate(nums, cfg, poolOrder) {
    var active = activeGates(cfg);
    var sorted = nums.slice().sort(sortAsc);
    if (active === 0) return { numbers: sorted, relaxed: false };

    var ti, tier, mask, norm, swapped;
    for (ti = 0; ti < TIER_ORDER.length; ti++) {
      tier = TIER_ORDER[ti];
      mask = active & ~tier;
      if (gatePass(sorted, cfg, mask)) return { numbers: sorted, relaxed: tier !== 0 };
      if (poolOrder) {
        swapped = swapRepair(sorted, cfg, mask, poolOrder);
        if (swapped) return { numbers: swapped, relaxed: tier !== 0 };
        if (mask & GATE_SUM) {
          norm = normalizeSum(sorted, cfg, poolOrder);
          if (norm) {
            if (gatePass(norm, cfg, mask)) return { numbers: norm, relaxed: tier !== 0 };
            swapped = swapRepair(norm, cfg, mask, poolOrder);
            if (swapped) return { numbers: swapped, relaxed: tier !== 0 };
          }
        }
      }
    }
    return { numbers: sorted, relaxed: true }; // tier 7 checks no gates
  }

  // ---- sampling helpers ----

  function sampleWeighted(weights, k, rng) {
    var avail = weights.slice();
    var chosen = [], i, n, total, r, idx, run;
    for (n = 0; n < k; n++) {
      total = 0;
      for (i = 0; i < avail.length; i++) if (avail[i] > 0) total += avail[i];
      if (total <= 0) break;
      r = rng() * total;
      run = 0;
      idx = -1;
      for (i = 0; i < avail.length; i++) {
        if (avail[i] <= 0) continue;
        run += avail[i];
        if (r < run) { idx = i; break; }
      }
      if (idx === -1) {
        for (i = avail.length - 1; i >= 0; i--) if (avail[i] > 0) { idx = i; break; }
      }
      chosen.push(idx + 1);
      avail[idx] = 0;
    }
    for (i = 1; i <= NUMBERS && chosen.length < k; i++) {
      if (chosen.indexOf(i) === -1) chosen.push(i);
    }
    return chosen.sort(sortAsc);
  }

  function uniformSampler(rng) {
    var weights = [], i;
    for (i = 0; i < NUMBERS; i++) weights[i] = 1;
    return function () { return sampleWeighted(weights, PICK, rng); };
  }

  // ---- contrarian (expectation management, not odds improvement) ----

  var CONTRARIAN_HIGH_WEIGHT = 3; // 32-49 favoured: fewer players bet these

  /**
   * Shapes many players bet by drawing lines on the slip or reusing
   * birthdays/sequences - sharing a jackpot when they hit. Patterns live on
   * the whole ticket, so this checks the ticket, not individual numbers.
   */
  function isPopularPattern(nums) {
    var i, tail, decade, counts = {}, decades = {}, maxCount = 0, maxDecade = 0, birthday = 0;
    for (i = 0; i < nums.length; i++) {
      if (nums[i] <= 31) birthday++;
      tail = nums[i] % 10;
      counts[tail] = (counts[tail] || 0) + 1;
      if (counts[tail] > maxCount) maxCount = counts[tail];
      decade = Math.floor((nums[i] - 1) / 10);
      decades[decade] = (decades[decade] || 0) + 1;
      if (decades[decade] > maxDecade) maxDecade = decades[decade];
    }
    if (birthday >= 5) return true;        // birthday-dominant ticket (1-31)
    if (maxCount >= 5) return true;        // five or more share one last digit
    if (maxDecade >= 5) return true;       // five or more share one decade
    var step = nums[1] - nums[0];
    if (step <= 0) return true;
    for (i = 2; i < nums.length; i++) {
      if (nums[i] - nums[i - 1] !== step) return false;
    }
    return true;                           // full arithmetic run (e.g. 1-2-3-4-5-6)
  }

  /**
   * Weighted sampler biased to numbers above 31, retrying until the ticket
   * avoids recognisable popular-pick patterns (bounded attempts; gates are
   * still the pipeline's contract, the pattern layer is only a preference).
   */
  function makeContrarianSampler(rng) {
    var weights = [], i;
    for (i = 1; i <= NUMBERS; i++) weights[i - 1] = i >= 32 ? CONTRARIAN_HIGH_WEIGHT : 1;
    function raw() { return sampleWeighted(weights, PICK, rng); }
    function sample() {
      var best = null, a, cand;
      for (a = 0; a < PATTERN_RETRY_ATTEMPTS; a++) {
        cand = raw();
        if (!isPopularPattern(cand)) return cand;
        if (!best) best = cand;
      }
      return best;
    }
    return { sample: sample, quality: contrarianQuality };
  }

  // ~0.51 at n=1 rising to 0.9 at n=31, 1.0 for every number above 31
  function contrarianQuality(n) {
    return n >= 32 ? 1 : 0.5 + 0.4 * (n / 31);
  }

  /**
   * Balanced: 50% hot (top quartile by frequency), 30% cold (top quartile by
   * gap, excluding hot), 20% mid-frequency pool - drawn without replacement.
   */
  function makeBalancedSampler(hist, rng) {
    var counts = frequencyMap(hist, hist.length);
    var gaps = gapMap(hist);
    var quartile = Math.ceil(NUMBERS / 4);
    var byFreq = [], byGap = [], i;
    for (i = 1; i <= NUMBERS; i++) byFreq.push(i);
    byFreq.sort(function (a, b) { return counts[b] - counts[a] || a - b; });
    var hot = byFreq.filter(function (n) { return counts[n] > 0; }).slice(0, quartile);
    var hotSet = {};
    hot.forEach(function (n) { hotSet[n] = true; });
    for (i = 1; i <= NUMBERS; i++) if (!hotSet[i]) byGap.push(i);
    byGap.sort(function (a, b) { return gaps[b] - gaps[a] || a - b; });
    var cold = byGap.slice(0, quartile);
    var coldSet = {};
    cold.forEach(function (n) { coldSet[n] = true; });
    var mid = [];
    for (i = 1; i <= NUMBERS; i++) if (!hotSet[i] && !coldSet[i]) mid.push(i);

    var buckets = [
      { share: 0.5, members: hot },
      { share: 0.3, members: cold },
      { share: 0.2, members: mid }
    ];
    var quality = {};
    hot.forEach(function (n) { quality[n] = 1; });
    cold.forEach(function (n) { quality[n] = 0.6; });
    mid.forEach(function (n) { quality[n] = 0.3; });

    function sample() {
      var chosen = [], guard, b, live, bi, r, acc, total, pickB, members;
      for (guard = 0; guard < PICK; guard++) {
        live = buckets.filter(function (bk) {
          return bk.members.some(function (m) { return chosen.indexOf(m) === -1; });
        });
        if (!live.length) break;
        total = 0;
        for (bi = 0; bi < live.length; bi++) total += live[bi].share;
        r = rng() * total;
        acc = 0;
        pickB = live[live.length - 1];
        for (bi = 0; bi < live.length; bi++) {
          acc += live[bi].share;
          if (r < acc) { pickB = live[bi]; break; }
        }
        members = pickB.members.filter(function (m) { return chosen.indexOf(m) === -1; });
        chosen.push(members[Math.floor(rng() * members.length)]);
      }
      for (guard = 1; guard <= NUMBERS && chosen.length < PICK; guard++) {
        if (chosen.indexOf(guard) === -1) chosen.push(guard);
      }
      return chosen.sort(sortAsc);
    }

    return { sample: sample, quality: function (n) { return quality[n] || 0.3; } };
  }

  // ---- ranked strategies ----

  function rankHotStreak(hist) {
    var w = [], i, j, nums, decay;
    for (i = 0; i <= NUMBERS; i++) w[i] = 0;
    for (i = 0; i < hist.length; i++) {
      decay = Math.exp(-HOT_LAMBDA * i);
      nums = validNumbers(hist[i]);
      for (j = 0; j < nums.length; j++) w[nums[j]] += decay;
    }
    var order = [];
    for (i = 1; i <= NUMBERS; i++) order.push(i);
    order.sort(function (a, b) { return w[b] - w[a] || a - b; });
    return order;
  }

  function rankColdRecovery(hist) {
    var len = hist.length;
    var gaps = gapMap(hist);
    var appearances = [], i, j, n, nums;
    for (i = 1; i <= NUMBERS; i++) appearances[i] = [];
    for (i = 0; i < len; i++) {
      nums = validNumbers(hist[i]);
      for (j = 0; j < nums.length; j++) appearances[nums[j]].push(i);
    }

    // global interval stats as the prior for numbers with little history
    var allGaps = [];
    for (i = 1; i <= NUMBERS; i++) {
      for (j = 1; j < appearances[i].length; j++) {
        allGaps.push(appearances[i][j] - appearances[i][j - 1]);
      }
    }
    var globalMean = allGaps.length ? mean(allGaps) : 49 / 6;
    var globalSd = allGaps.length ? Math.max(stddev(allGaps), MIN_SIGMA) : Math.max(globalMean / 2, MIN_SIGMA);

    var z = [];
    for (i = 1; i <= NUMBERS; i++) {
      var G = gaps[i]; // Infinity when never drawn in the window
      var M, sd;
      if (appearances[i].length >= 2) {
        var own = [];
        for (j = 1; j < appearances[i].length; j++) own.push(appearances[i][j] - appearances[i][j - 1]);
        M = mean(own);
        sd = Math.max(stddev(own), MIN_SIGMA);
      } else {
        M = globalMean;
        sd = globalSd;
      }
      var gVal = G === Infinity ? len : G;
      var score = (gVal - M) / sd;
      z[i] = Math.max(-MAX_Z, Math.min(MAX_Z, score));
      if (G === Infinity) z[i] = MAX_Z; // never seen in the window is most overdue
    }

    var order = [];
    for (i = 1; i <= NUMBERS; i++) order.push(i);
    order.sort(function (a, b) { return z[b] - z[a] || a - b; });
    return order;
  }

  function rankMarkov(hist) {
    var counts = [], rowSum = [], i, j, k, a, b;
    for (i = 0; i <= NUMBERS; i++) {
      counts[i] = [];
      rowSum[i] = 0;
      for (j = 0; j <= NUMBERS; j++) counts[i][j] = 0;
    }
    for (k = 0; k + 1 < hist.length; k++) {
      var from = validNumbers(hist[k]);
      var to = validNumbers(hist[k + 1]);
      for (i = 0; i < from.length; i++) {
        a = from[i];
        for (j = 0; j < to.length; j++) {
          b = to[j];
          counts[a][b]++;
        }
        rowSum[a] += to.length;
      }
    }
    var seed = validNumbers(hist[0]);
    var score = [];
    for (i = 0; i <= NUMBERS; i++) score[i] = 0;
    for (i = 0; i < seed.length; i++) {
      a = seed[i];
      if (!rowSum[a]) continue;
      for (j = 1; j <= NUMBERS; j++) score[j] += counts[a][j] / rowSum[a];
    }
    var order = [];
    for (i = 1; i <= NUMBERS; i++) order.push(i);
    order.sort(function (x, y) { return score[y] - score[x] || x - y; });
    return order;
  }

  function rankMonteCarlo(hist, cfg, rng) {
    var counts = frequencyMap(hist, hist.length);
    var gaps = gapMap(hist);
    var maxFreq = 0, maxGap = 0, i, n;
    for (i = 1; i <= NUMBERS; i++) {
      if (counts[i] > maxFreq) maxFreq = counts[i];
      if (gaps[i] !== Infinity && gaps[i] > maxGap) maxGap = gaps[i];
    }
    var weights = [];
    for (i = 1; i <= NUMBERS; i++) {
      var fNorm = maxFreq ? counts[i] / maxFreq : 0;
      var overdue = gaps[i] === Infinity ? 1 : (maxGap ? gaps[i] / maxGap : 0);
      weights[i - 1] = 0.5 * fNorm + 0.5 * overdue + 0.0001;
    }

    var conv = [], active = activeGates(cfg), valid = 0, it, ticket;
    for (i = 0; i <= NUMBERS; i++) conv[i] = 0;
    for (it = 0; it < cfg.iterations; it++) {
      ticket = sampleWeighted(weights, PICK, rng);
      if (active === 0 || gatePass(ticket, cfg, active)) {
        valid++;
        for (i = 0; i < ticket.length; i++) conv[ticket[i]]++;
      }
    }
    if (valid === 0) {
      // nothing passed the gates - rank on raw convergence instead
      for (it = 0; it < cfg.iterations; it++) {
        ticket = sampleWeighted(weights, PICK, rng);
        for (i = 0; i < ticket.length; i++) conv[ticket[i]]++;
      }
    }
    var order = [];
    for (i = 1; i <= NUMBERS; i++) order.push(i);
    order.sort(function (a, b) { return conv[b] - conv[a] || a - b; });
    return order;
  }

  // ---- public API ----

  function generatePick(strategy, draws, config, rng) {
    if (STRATEGIES.indexOf(strategy) === -1) throw new Error('Unknown strategy: ' + strategy);
    rng = rng || Math.random;
    var cfg = mergeConfig(config);
    var hist = windowOf(draws, cfg);

    var degraded = null;
    if (!hist.length) degraded = 'no_history';
    else if (hist.length < MIN_HISTORY) degraded = 'short_history';

    var ranked = null, sampler = null;
    var rankedQuality = null;
    if (strategy === 'contrarian') {
      // history-independent: the bias is about what other players bet
      var contra = makeContrarianSampler(rng);
      sampler = contra.sample;
      rankedQuality = contra.quality;
    } else if (hist.length) {
      if (strategy === 'balanced') {
        var b = makeBalancedSampler(hist, rng);
        sampler = b.sample;
        rankedQuality = b.quality;
      } else if (strategy === 'hot_streak') {
        ranked = rankHotStreak(hist);
      } else if (strategy === 'cold_recovery') {
        ranked = rankColdRecovery(hist);
      } else if (strategy === 'markov_chain') {
        ranked = rankMarkov(hist);
      } else if (strategy === 'monte_carlo') {
        ranked = rankMonteCarlo(hist, cfg, rng);
      }
    } else {
      sampler = uniformSampler(rng);
      rankedQuality = function () { return 0.5; };
    }

    var resolved;
    if (ranked) {
      resolved = resolveCandidate(ranked.slice(0, PICK), cfg, ranked);
    } else {
      var active = activeGates(cfg);
      var candidate = null, attempt;
      for (attempt = 0; attempt < REJECTION_ATTEMPTS; attempt++) {
        candidate = sampler();
        if (gatePass(candidate, cfg, active)) break;
        candidate = null;
      }
      if (candidate) {
        resolved = { numbers: candidate.slice().sort(sortAsc), relaxed: false };
      } else {
        resolved = resolveCandidate(sampler(), cfg, ALL_ORDER);
      }
    }

    if (!degraded && resolved.relaxed) degraded = 'gates_relaxed';

    // score: 60% strategy confidence of the chosen numbers, 40% gates honoured
    var active = activeGates(cfg);
    var passed = 0, total = 0, i;
    if (active & GATE_CONSEC) { total++; if (hasConsecutive(resolved.numbers)) passed++; }
    if (active & GATE_ODD) { total++; if (oddInRange(oddCount(resolved.numbers), cfg.oddEvenRatio)) passed++; }
    if (active & GATE_SUM) {
      total++;
      var s = sumOf(resolved.numbers);
      if (s >= cfg.sumRange[0] && s <= cfg.sumRange[1]) passed++;
    }

    var quality = 0;
    var rankIndex = null;
    if (ranked) {
      rankIndex = {};
      for (i = 0; i < ranked.length; i++) rankIndex[ranked[i]] = i;
    }
    for (i = 0; i < resolved.numbers.length; i++) {
      var q;
      if (rankIndex) q = (NUMBERS - rankIndex[resolved.numbers[i]]) / NUMBERS;
      else q = rankedQuality ? rankedQuality(resolved.numbers[i]) : 0.5;
      quality += q;
    }
    quality /= PICK;
    var gateRatio = total ? passed / total : 1;
    var score = Math.round(100 * (0.6 * quality + 0.4 * gateRatio));
    score = Math.max(0, Math.min(100, score));

    // breakdown: hot/cold membership over the analysed window
    var counts = hist.length ? frequencyMap(hist, hist.length) : frequencyMap([], 0);
    var gaps = hist.length ? gapMap(hist) : gapMap([]);
    var quartile = Math.ceil(NUMBERS / 4);
    var byFreq = [], byGap = [], n;
    for (n = 1; n <= NUMBERS; n++) byFreq.push(n);
    byFreq.sort(function (a, b) { return counts[b] - counts[a] || a - b; });
    var hotSet = {};
    byFreq.filter(function (x) { return counts[x] > 0; }).slice(0, quartile).forEach(function (x) { hotSet[x] = true; });
    for (n = 1; n <= NUMBERS; n++) if (!hotSet[n]) byGap.push(n);
    byGap.sort(function (a, b) { return gaps[b] - gaps[a] || a - b; });
    var coldSet = {};
    byGap.slice(0, quartile).forEach(function (x) { coldSet[x] = true; });

    var hotCount = 0, coldCount = 0;
    for (i = 0; i < resolved.numbers.length; i++) {
      if (hotSet[resolved.numbers[i]]) hotCount++;
      if (coldSet[resolved.numbers[i]]) coldCount++;
    }

    return {
      numbers: resolved.numbers,
      score: score,
      strategy: strategy,
      degraded: degraded,
      breakdown: {
        hotCount: hotCount,
        coldCount: coldCount,
        sum: sumOf(resolved.numbers),
        oddEven: oddCount(resolved.numbers) + ' Odd ' + (PICK - oddCount(resolved.numbers)) + ' Even'
      }
    };
  }

  /**
   * Hit rate of a strategy: for each of the last `window` draws, generate a
   * ticket from everything newer than it, then count how many draws match at
   * least `minHits` numbers. Draws without `minTrain` draws of history are
   * skipped rather than guessed at.
   */
  function backtest(strategy, draws, config, opts) {
    opts = opts || {};
    var cfg = mergeConfig(config);
    var window = opts.window > 0 ? opts.window : 20;
    var minHits = opts.minHits > 0 ? opts.minHits : 3;
    var minTrain = opts.minTrain > 0 ? opts.minTrain : MIN_HISTORY;
    var rng = opts.rng || Math.random;
    var all = Array.isArray(draws) ? draws : [];

    var hits = 0, evaluated = 0, k;
    for (k = 0; k < window && k < all.length; k++) {
      var train = all.slice(k + 1);
      if (train.length < minTrain) continue;
      var pick = generatePick(strategy, train, cfg, rng);
      var actual = validNumbers(all[k]);
      var match = 0, i;
      for (i = 0; i < pick.numbers.length; i++) {
        if (actual.indexOf(pick.numbers[i]) !== -1) match++;
      }
      evaluated++;
      if (match >= minHits) hits++;
    }
    return {
      hitRate: evaluated ? Math.round((hits / evaluated) * 100) : 0,
      hits: hits,
      evaluated: evaluated,
      window: window,
      minHits: minHits
    };
  }

  return {
    generatePick: generatePick,
    backtest: backtest,
    frequencyMap: frequencyMap,
    gapMap: gapMap,
    normalizeDraw: normalizeDraw,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    STRATEGIES: STRATEGIES,
    MIN_HISTORY: MIN_HISTORY
  };
});
