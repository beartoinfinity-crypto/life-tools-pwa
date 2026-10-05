// The worker glue registers itself on globalThis in Node (no self/importScripts).
let posted;

beforeAll(() => {
  posted = [];
  globalThis.postMessage = (m) => posted.push(m);
  require('../prediction-worker');
});

afterAll(() => {
  delete globalThis.postMessage;
  delete globalThis.onmessage;
});

function makeDraws(n) {
  return Array.from({ length: n }, (_, i) => ({
    drawNo: `26/${100 - i}`,
    date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
    numbers: [1 + (i % 10), 2 + ((i * 3) % 10), 11 + (i % 5), 21 + (i % 7), 31 + (i % 6), 41 + (i % 6)]
      .sort((a, b) => a - b),
    extraNumber: 5,
  }));
}

describe('prediction-worker', () => {
  beforeEach(() => { posted.length = 0; });

  it('loads the engine (require path outside a browser)', () => {
    expect(typeof globalThis.onmessage).toBe('function');
  });

  it('answers a generate request with a valid ticket', () => {
    globalThis.onmessage({
      data: { id: 7, strategy: 'balanced', draws: makeDraws(30), config: {} },
    });
    expect(posted).toHaveLength(1);
    const msg = posted[0];
    expect(msg.id).toBe(7);
    expect(msg.ok).toBe(true);
    expect(msg.result.numbers).toHaveLength(6);
    expect(msg.result.breakdown).toBeTruthy();
    expect(msg.backtest).toBe(null);
  });

  it('includes a backtest when asked', () => {
    globalThis.onmessage({
      data: {
        id: 8,
        strategy: 'hot_streak',
        draws: makeDraws(30),
        config: { iterations: 200 },
        wantBacktest: true,
        backtestOpts: { window: 10, minHits: 3 },
      },
    });
    expect(posted[0].ok).toBe(true);
    expect(posted[0].backtest.window).toBe(10);
    expect(posted[0].backtest.evaluated).toBeGreaterThan(0);
  });

  it('reports errors instead of throwing', () => {
    globalThis.onmessage({
      data: { id: 9, strategy: 'not_a_strategy', draws: makeDraws(30), config: {} },
    });
    expect(posted[0].ok).toBe(false);
    expect(posted[0].error).toContain('Unknown strategy');
  });

  it('ignores empty messages', () => {
    globalThis.onmessage({ data: null });
    expect(posted).toHaveLength(0);
  });
});
