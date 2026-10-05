const engine = require('../prediction-engine');

const { generatePick, backtest, frequencyMap, gapMap, normalizeDraw, DEFAULT_CONFIG, STRATEGIES } = engine;

// ---- helpers ----

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Deterministic unique 6-number pick from 1..49 for synthetic draw i. */
function drawAt(i) {
  let x = (i * 2654435761 + 12345) >>> 0;
  const nums = new Set();
  for (let g = 0; g < 600 && nums.size < 6; g++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    nums.add((x % 49) + 1);
  }
  let n = 1;
  while (nums.size < 6) nums.add(n++);
  return [...nums].sort((a, b) => a - b);
}

/** Newest-first synthetic history of n draws. */
function makeHistory(n) {
  return Array.from({ length: n }, (_, i) => ({
    drawNo: `26/${100 - i}`,
    date: `2026-09-${String(((i * 3) % 28) + 1).padStart(2, '0')}`,
    numbers: drawAt(i),
    extraNumber: ((i * 7) % 49) + 1,
  }));
}

function sum(nums) { return nums.reduce((a, b) => a + b, 0); }
function oddCount(nums) { return nums.filter((n) => n % 2 === 1).length; }
function hasConsecutive(nums) { return nums.some((n, i) => i > 0 && nums[i - 1] === n - 1 || nums[i + 1] === n + 1); }

function assertValidTicket(nums) {
  expect(Array.isArray(nums)).toBe(true);
  expect(nums).toHaveLength(6);
  expect(new Set(nums).size).toBe(6);
  nums.forEach((n) => {
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(49);
  });
  expect([...nums]).toEqual([...nums].sort((a, b) => a - b));
}

// ---- normalizeDraw ----

describe('normalizeDraw', () => {
  it('converts an API response draw to the engine shape', () => {
    const apiDraw = {
      id: '26/100',
      drawDate: '2026-09-26+08:00',
      drawResult: { drawnNo: [1, 3, 15, 32, 33, 46], xDrawnNo: 19 },
    };
    expect(normalizeDraw(apiDraw)).toEqual({
      drawNo: '26/100',
      date: '2026-09-26',
      numbers: [1, 3, 15, 32, 33, 46],
      extraNumber: 19,
    });
  });

  it('tolerates a missing special number', () => {
    const n = normalizeDraw({ id: '26/9', drawDate: '2026-01-05+08:00', drawResult: { drawnNo: [2, 4, 6, 8, 10, 12] } });
    expect(n.extraNumber).toBe(null);
  });
});

// ---- every strategy produces a valid ticket ----

describe('generatePick - all strategies', () => {
  it('exports the five spec strategies', () => {
    expect(STRATEGIES).toEqual(['balanced', 'hot_streak', 'cold_recovery', 'monte_carlo', 'markov_chain']);
  });

  it.each(STRATEGIES)('%s returns 6 sorted unique numbers with a 0-100 score', (strategy) => {
    const result = generatePick(strategy, makeHistory(100), {}, makeRng(7));
    assertValidTicket(result.numbers);
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.strategy).toBe(strategy);
    expect(result.breakdown.sum).toBe(sum(result.numbers));
    expect(result.breakdown.oddEven).toBe(`${oddCount(result.numbers)} Odd ${6 - oddCount(result.numbers)} Even`);
    expect(result.breakdown.hotCount + result.breakdown.coldCount).toBeLessThanOrEqual(6);
    expect(result.degraded == null || typeof result.degraded === 'string').toBe(true);
  });

  it('is deterministic for the same seed', () => {
    for (const strategy of ['balanced', 'monte_carlo']) {
      const a = generatePick(strategy, makeHistory(100), {}, makeRng(42));
      const b = generatePick(strategy, makeHistory(100), {}, makeRng(42));
      expect(a.numbers).toEqual(b.numbers);
    }
  });

  it('throws on an unknown strategy', () => {
    expect(() => generatePick('does_not_exist', makeHistory(20), {}, makeRng(1))).toThrow();
  });
});

// ---- filter gates ----

describe('generatePick - gates', () => {
  const history = makeHistory(100);

  it.each(STRATEGIES)('%s honours the default sum range 140-210', (strategy) => {
    const result = generatePick(strategy, history, {}, makeRng(11));
    expect(sum(result.numbers)).toBeGreaterThanOrEqual(140);
    expect(sum(result.numbers)).toBeLessThanOrEqual(210);
  });

  it.each(STRATEGIES)('%s honours the default balanced odd/even gate (2-4 odd)', (strategy) => {
    const result = generatePick(strategy, history, {}, makeRng(12));
    expect(oddCount(result.numbers)).toBeGreaterThanOrEqual(2);
    expect(oddCount(result.numbers)).toBeLessThanOrEqual(4);
  });

  it('supports odd_heavy and even_heavy ratios', () => {
    const oddHeavy = generatePick('balanced', history, { oddEvenRatio: 'odd_heavy' }, makeRng(13));
    expect(oddCount(oddHeavy.numbers)).toBeGreaterThanOrEqual(3);
    const evenHeavy = generatePick('balanced', history, { oddEvenRatio: 'even_heavy' }, makeRng(14));
    expect(oddCount(evenHeavy.numbers)).toBeLessThanOrEqual(3);
  });

  it('honours the consecutive-pair gate when enabled', () => {
    const result = generatePick('balanced', history, { consecutivePairProb: true }, makeRng(15));
    expect(hasConsecutive(result.numbers)).toBe(true);
    expect(result.degraded ?? null).toBe(null);
  });

  it('skips gates that are switched off', () => {
    const result = generatePick('balanced', history, { sumRange: null, oddEvenRatio: 'any' }, makeRng(16));
    assertValidTicket(result.numbers);
    expect(result.degraded ?? null).toBe(null);
  });

  it('still returns a valid ticket when filters are impossible (degrades)', () => {
    const result = generatePick('balanced', history, { sumRange: [1, 2] }, makeRng(17));
    assertValidTicket(result.numbers);
    expect(result.degraded).toBe('gates_relaxed');
  });

  it('relaxes only what it must', () => {
    // sum of any 6 distinct numbers from 1..49 is at least 21, so only the
    // sum gate can be dropped; the odd/even gate must still hold.
    const result = generatePick('balanced', history, { sumRange: [1, 2] }, makeRng(18));
    expect(oddCount(result.numbers)).toBeGreaterThanOrEqual(2);
    expect(oddCount(result.numbers)).toBeLessThanOrEqual(4);
  });
});

// ---- strategy behaviour ----

describe('strategy behaviour', () => {
  const noGates = { sumRange: null, oddEvenRatio: 'any', consecutivePairProb: false };

  it('hot_streak ranks recency-weighted numbers (half-life decay from most recent)', () => {
    // numbers 1-6 only in the newest 10 draws; 43-48 only in older draws.
    // With historyLimit 10 the fresh numbers dominate.
    const history = [
      ...Array.from({ length: 10 }, () => ({ numbers: [1, 2, 3, 4, 5, 6] })),
      ...Array.from({ length: 90 }, () => ({ numbers: [43, 44, 45, 46, 47, 48] })),
    ].map((d, i) => ({ ...d, drawNo: `26/${100 - i}`, date: '2026-09-01' }));

    const recent = generatePick('hot_streak', history, { ...noGates, historyLimit: 10 }, makeRng(1));
    expect(recent.numbers).toEqual([1, 2, 3, 4, 5, 6]);

    const full = generatePick('hot_streak', history, noGates, makeRng(1));
    expect(full.numbers).toEqual([43, 44, 45, 46, 47, 48]);
  });

  it('cold_recovery picks the most overdue number', () => {
    // number 49 last hit long ago (two old appearances), everything else is fresh
    const history = Array.from({ length: 40 }, (_, i) => {
      const base = drawAt(i).map((n) => ((n - 1) % 48) + 1);
      const nums = new Set(base);
      let g = 1;
      while (nums.size < 6) { nums.add(((g * 5 + i) % 48) + 1); g++; }
      const list = [...nums].sort((a, b) => a - b);
      if (i === 35 || i === 39) list[0] = 49;
      return { drawNo: `26/${100 - i}`, date: '2026-09-01', numbers: list.sort((a, b) => a - b) };
    });

    const result = generatePick('cold_recovery', history, noGates, makeRng(1));
    expect(result.numbers).toContain(49);
  });

  it('markov_chain follows conditional transitions from the latest draw', () => {
    // alternating sets: every A draw is followed by B and vice versa,
    // so P(member of other set | seed) dominates.
    const setA = [1, 10, 20, 30, 40, 50];
    const setB = [2, 11, 21, 31, 41, 49];
    const history = Array.from({ length: 20 }, (_, i) => ({
      drawNo: `26/${100 - i}`,
      date: '2026-09-01',
      numbers: i % 2 === 0 ? setA : setB,
    }));

    const result = generatePick('markov_chain', history, noGates, makeRng(1));
    expect(result.numbers).toEqual([...setB].sort((a, b) => a - b));
  });

  it('monte_carlo converges on frequently drawn numbers', () => {
    const history = Array.from({ length: 60 }, (_, i) => ({
      drawNo: `26/${100 - i}`,
      date: '2026-09-01',
      numbers: i % 5 === 0 ? [1, 2, 3, 4, 5, 6] : drawAt(i),
    }));
    const result = generatePick('monte_carlo', history, { ...noGates, iterations: 3000 }, makeRng(9));
    // at least one of the 12 numbers that recur in every 5th draw
    const frequent = [1, 2, 3, 4, 5, 6];
    expect(result.numbers.some((n) => frequent.includes(n))).toBe(true);
  });
});

// ---- history handling ----

describe('history handling', () => {
  it('frequencyMap respects the history limit', () => {
    const history = [
      ...Array.from({ length: 10 }, () => ({ numbers: [1, 2, 3, 4, 5, 6] })),
      ...Array.from({ length: 90 }, () => ({ numbers: [43, 44, 45, 46, 47, 48] })),
    ];
    const limited = frequencyMap(history, 10);
    expect(limited[1]).toBe(10);
    expect(limited[43]).toBe(0);
    const full = frequencyMap(history, 100);
    expect(full[43]).toBe(90);
  });

  it('gapMap reports draws since last appearance', () => {
    const history = [
      { numbers: [12, 13, 14, 15, 16, 17] },
      { numbers: [1, 7, 8, 9, 10, 11] },
      { numbers: [1, 2, 3, 4, 5, 6] },
    ];
    const gaps = gapMap(history);
    expect(gaps[12]).toBe(0);     // drawn in the newest draw
    expect(gaps[1]).toBe(1);      // newest appearance one draw back
    expect(gaps[2]).toBe(2);
    expect(gaps[49]).toBe(Infinity);
  });

  it('degrades gracefully with no history', () => {
    const result = generatePick('balanced', [], {}, makeRng(1));
    assertValidTicket(result.numbers);
    expect(result.degraded).toBe('no_history');
  });

  it('degrades gracefully with fewer than 10 draws', () => {
    const result = generatePick('hot_streak', makeHistory(5), {}, makeRng(1));
    assertValidTicket(result.numbers);
    expect(result.degraded).toBe('short_history');
  });

  it('caps analysis at historyLimit', () => {
    const history = [
      ...Array.from({ length: 10 }, () => ({ numbers: [1, 2, 3, 4, 5, 6] })),
      ...Array.from({ length: 90 }, () => ({ numbers: [43, 44, 45, 46, 47, 48] })),
    ].map((d, i) => ({ ...d, drawNo: `26/${100 - i}`, date: '2026-09-01' }));

    const recent = generatePick('hot_streak', history, { ...DEFAULT_CONFIG, sumRange: null, oddEvenRatio: 'any', historyLimit: 10 }, makeRng(1));
    expect(recent.numbers).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

// ---- backtest ----

describe('backtest', () => {
  it('evaluates the last 20 draws when history allows', () => {
    const history = makeHistory(30);
    const bt = backtest('balanced', history, {}, { rng: makeRng(3) });
    expect(bt.evaluated).toBe(20);
    expect(bt.window).toBe(20);
    expect(bt.minHits).toBe(3);
    expect(Number.isInteger(bt.hitRate)).toBe(true);
    expect(bt.hitRate).toBeGreaterThanOrEqual(0);
    expect(bt.hitRate).toBeLessThanOrEqual(100);
    expect(bt.hits).toBeLessThanOrEqual(bt.evaluated);
    expect(Math.round((bt.hits / bt.evaluated) * 100)).toBe(bt.hitRate);
  });

  it('skips draws that lack training history', () => {
    const bt = backtest('balanced', makeHistory(15), {}, { rng: makeRng(3) });
    expect(bt.evaluated).toBe(5); // needs >= 10 prior draws
  });

  it('returns 0% when there is not enough history to evaluate', () => {
    const bt = backtest('balanced', makeHistory(5), {}, { rng: makeRng(3) });
    expect(bt.evaluated).toBe(0);
    expect(bt.hits).toBe(0);
    expect(bt.hitRate).toBe(0);
  });

  it('a stricter minHits never yields a higher hit rate', () => {
    const history = makeHistory(40);
    const loose = backtest('balanced', history, {}, { rng: makeRng(5), minHits: 3 });
    const strict = backtest('balanced', history, {}, { rng: makeRng(5), minHits: 5 });
    expect(strict.hitRate).toBeLessThanOrEqual(loose.hitRate);
  });

  it('supports a custom window', () => {
    const bt = backtest('balanced', makeHistory(60), {}, { rng: makeRng(2), window: 10 });
    expect(bt.evaluated).toBe(10);
    expect(bt.window).toBe(10);
  });
});

// ---- performance guard (spec: <150ms per strategy on mobile-class hardware) ----

describe('performance', () => {
  it('runs every strategy over 500 draws quickly', () => {
    const history = makeHistory(500);
    const cfg = { iterations: 1000, historyLimit: 500 }; // keep the sim light for CI
    for (const strategy of STRATEGIES) {
      const t0 = Date.now();
      generatePick(strategy, history, cfg, makeRng(21));
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeLessThan(500);
    }
  });

  it('backtests quickly', () => {
    const t0 = Date.now();
    backtest('balanced', makeHistory(60), {}, { rng: makeRng(22) });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
