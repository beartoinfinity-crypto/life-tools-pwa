const request = require('supertest');
const { createApp } = require('../api');

let app;

afterEach(() => {
  if (app && app._store) app._store.close();
});

const sampleDraws = [
  { draw: '26/089', date: '2026-08-15', numbers: [4, 16, 25, 27, 28, 33], special: 14, source: 'test' },
  { draw: '26/088', date: '2026-08-13', numbers: [21, 27, 35, 40, 47, 48], special: 23, source: 'test' },
  { draw: '25/134', date: '2025-12-28', numbers: [7, 10, 11, 19, 25, 30], special: 45, source: 'test' },
];

describe('GET /api/marksix', () => {
  it('returns empty when no data', async () => {
    app = createApp();
    const res = await request(app).get('/api/marksix');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('empty');
    expect(res.body.data.lotteryDraws).toEqual([]);
  });

  it('returns latest draws from DB', async () => {
    app = createApp();
    app._store.upsertBatch(sampleDraws);
    const res = await request(app).get('/api/marksix?lastNDraw=2');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('database');
    expect(res.body.data.lotteryDraws.length).toBe(2);
    expect(res.body.data.lotteryDraws[0].id).toBe('26/089');
  });

  it('response shape has id, drawDate, drawResult', async () => {
    app = createApp();
    app._store.upsertBatch(sampleDraws);
    const res = await request(app).get('/api/marksix?lastNDraw=1');
    const draw = res.body.data.lotteryDraws[0];
    expect(draw).toHaveProperty('id');
    expect(draw).toHaveProperty('drawDate');
    expect(draw).toHaveProperty('drawResult');
    expect(draw.drawResult).toHaveProperty('drawnNo');
    expect(draw.drawResult).toHaveProperty('xDrawnNo');
  });

  it('drawDate includes +08:00 offset', async () => {
    app = createApp();
    app._store.upsertBatch(sampleDraws);
    const res = await request(app).get('/api/marksix?lastNDraw=1');
    expect(res.body.data.lotteryDraws[0].drawDate).toContain('+08:00');
  });

  it('does not include year, no, or status fields', async () => {
    app = createApp();
    app._store.upsertBatch(sampleDraws);
    const res = await request(app).get('/api/marksix?lastNDraw=1');
    const draw = res.body.data.lotteryDraws[0];
    expect(draw).not.toHaveProperty('year');
    expect(draw).not.toHaveProperty('no');
    expect(draw).not.toHaveProperty('status');
  });
});

describe('GET /api/marksix/history', () => {
  it('returns draws filtered by year', async () => {
    app = createApp();
    app._store.upsertBatch(sampleDraws);
    const res = await request(app).get('/api/marksix/history?year=2026');
    expect(res.body.data.lotteryDraws.length).toBe(2);
  });

  it('returns draws filtered by date range', async () => {
    app = createApp();
    app._store.upsertBatch(sampleDraws);
    const res = await request(app).get('/api/marksix/history?from=2026-08-13&to=2026-08-15');
    expect(res.body.data.lotteryDraws.length).toBe(2);
  });

  it('returns draws with limit', async () => {
    app = createApp();
    app._store.upsertBatch(sampleDraws);
    const res = await request(app).get('/api/marksix/history?limit=1');
    expect(res.body.data.lotteryDraws.length).toBe(1);
  });
});
