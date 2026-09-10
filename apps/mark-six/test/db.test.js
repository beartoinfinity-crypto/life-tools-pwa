const { createDB } = require('../db');

let store;

afterEach(() => {
  if (store) store.close();
});

const sampleDraws = [
  { draw: '26/089', date: '2026-08-15', numbers: [4, 16, 25, 27, 28, 33], special: 14, source: 'lotteryextreme' },
  { draw: '26/088', date: '2026-08-13', numbers: [21, 27, 35, 40, 47, 48], special: 23, source: 'lotteryextreme' },
  { draw: '26/087', date: '2026-08-11', numbers: [1, 5, 12, 19, 34, 42], special: 7, source: 'lottery.hk' },
  { draw: '25/134', date: '2025-12-28', numbers: [7, 10, 11, 19, 25, 30], special: 45, source: 'github' },
];

describe('db.count', () => {
  it('returns 0 for empty database', () => {
    store = createDB();
    expect(store.count()).toBe(0);
  });

  it('returns correct count after inserts', () => {
    store = createDB();
    store.upsertBatch(sampleDraws);
    expect(store.count()).toBe(4);
  });
});

describe('db.upsert', () => {
  it('inserts a draw', () => {
    store = createDB();
    store.upsert(sampleDraws[0]);
    expect(store.count()).toBe(1);
  });

  it('replaces on duplicate draw number', () => {
    store = createDB();
    store.upsert(sampleDraws[0]);
    store.upsert({ ...sampleDraws[0], special: 99 });
    expect(store.count()).toBe(1);
    const draws = store.getDraws(1);
    expect(draws[0].special).toBe(99);
  });
});

describe('db.getDraws', () => {
  it('returns draws ordered by date descending', () => {
    store = createDB();
    store.upsertBatch(sampleDraws);
    const draws = store.getDraws(10);
    expect(draws[0].draw).toBe('26/089');
    expect(draws[3].draw).toBe('25/134');
  });

  it('respects limit', () => {
    store = createDB();
    store.upsertBatch(sampleDraws);
    const draws = store.getDraws(2);
    expect(draws.length).toBe(2);
  });

  it('parses numbers from JSON string', () => {
    store = createDB();
    store.upsert(sampleDraws[0]);
    const draws = store.getDraws(1);
    expect(draws[0].numbers).toEqual([4, 16, 25, 27, 28, 33]);
  });
});

describe('db.getDrawsByYear', () => {
  it('returns only draws from specified year', () => {
    store = createDB();
    store.upsertBatch(sampleDraws);
    const draws = store.getDrawsByYear('2026');
    expect(draws.length).toBe(3);
  });

  it('returns empty for nonexistent year', () => {
    store = createDB();
    store.upsertBatch(sampleDraws);
    const draws = store.getDrawsByYear('2020');
    expect(draws.length).toBe(0);
  });
});

describe('db.getDrawsRange', () => {
  it('returns draws within date range', () => {
    store = createDB();
    store.upsertBatch(sampleDraws);
    const draws = store.getDrawsRange('2026-08-11', '2026-08-15');
    expect(draws.length).toBe(3);
  });

  it('filters by from only', () => {
    store = createDB();
    store.upsertBatch(sampleDraws);
    const draws = store.getDrawsRange('2026-08-13', null);
    expect(draws.length).toBe(2);
  });

  it('filters by to only', () => {
    store = createDB();
    store.upsertBatch(sampleDraws);
    const draws = store.getDrawsRange(null, '2025-12-31');
    expect(draws.length).toBe(1);
    expect(draws[0].draw).toBe('25/134');
  });
});

describe('db.meta', () => {
  it('returns null for missing key', () => {
    store = createDB();
    expect(store.metaGet('lastRefresh')).toBeNull();
  });

  it('stores and retrieves meta values', () => {
    store = createDB();
    store.metaSet('lastRefresh', '2026-08-15T12:00:00Z');
    expect(store.metaGet('lastRefresh')).toBe('2026-08-15T12:00:00Z');
  });

  it('overwrites existing meta values', () => {
    store = createDB();
    store.metaSet('lastRefresh', '2026-08-15T12:00:00Z');
    store.metaSet('lastRefresh', '2026-08-16T12:00:00Z');
    expect(store.metaGet('lastRefresh')).toBe('2026-08-16T12:00:00Z');
  });
});
