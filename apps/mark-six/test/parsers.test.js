const fs = require('fs');
const path = require('path');
const {
  parseLotteryExtreme,
  parseLotteryHk,
  parseGitHubData,
  toISODate,
  toResponseDate,
  parseHKJCFixtures,
  upcomingDrawDates,
} = require('../parsers');

const fixturesDir = path.join(__dirname, 'fixtures');

describe('parseLotteryExtreme', () => {
  const html = fs.readFileSync(path.join(fixturesDir, 'lotteryextreme.html'), 'utf8');

  it('parses draws from HTML', () => {
    const draws = parseLotteryExtreme(html);
    expect(draws.length).toBe(2);
  });

  it('extracts draw number', () => {
    const draws = parseLotteryExtreme(html);
    expect(draws[0].draw).toBe('26/089');
  });

  it('extracts date as DD/MM/YYYY', () => {
    const draws = parseLotteryExtreme(html);
    expect(draws[0].date).toBe('15/08/2026');
  });

  it('extracts 6 main numbers', () => {
    const draws = parseLotteryExtreme(html);
    expect(draws[0].numbers).toEqual([4, 16, 25, 27, 28, 33]);
  });

  it('extracts special number', () => {
    const draws = parseLotteryExtreme(html);
    expect(draws[0].special).toBe(14);
  });

  it('returns empty array for empty HTML', () => {
    expect(parseLotteryExtreme('')).toEqual([]);
  });
});

describe('parseLotteryHk', () => {
  const html = fs.readFileSync(path.join(fixturesDir, 'lotteryhk.html'), 'utf8');

  it('parses draws from HTML', () => {
    const draws = parseLotteryHk(html);
    expect(draws.length).toBe(2);
  });

  it('extracts draw number', () => {
    const draws = parseLotteryHk(html);
    expect(draws[0].draw).toBe('26/089');
  });

  it('extracts date as DD/MM/YYYY', () => {
    const draws = parseLotteryHk(html);
    expect(draws[0].date).toBe('15/08/2026');
  });

  it('extracts 6 main numbers', () => {
    const draws = parseLotteryHk(html);
    expect(draws[0].numbers).toEqual([4, 16, 25, 27, 28, 33]);
  });

  it('extracts special number from plus class', () => {
    const draws = parseLotteryHk(html);
    expect(draws[0].special).toBe(14);
  });

  it('returns empty array for empty HTML', () => {
    expect(parseLotteryHk('')).toEqual([]);
  });
});

describe('parseGitHubData', () => {
  const data = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'github.json'), 'utf8'));

  it('parses draws from JSON array', () => {
    const draws = parseGitHubData(data);
    expect(draws.length).toBe(2);
  });

  it('converts date from YYYY-MM-DD to DD/MM/YYYY', () => {
    const draws = parseGitHubData(data);
    expect(draws[0].date).toBe('15/08/2026');
  });

  it('extracts numbers as array of numbers', () => {
    const draws = parseGitHubData(data);
    expect(draws[0].numbers).toEqual([4, 16, 25, 27, 28, 33]);
  });

  it('extracts special number', () => {
    const draws = parseGitHubData(data);
    expect(draws[0].special).toBe(14);
  });
});

describe('toISODate', () => {
  it('converts DD/MM/YYYY to YYYY-MM-DD', () => {
    expect(toISODate('15/08/2026')).toBe('2026-08-15');
  });

  it('returns empty string for empty input', () => {
    expect(toISODate('')).toBe('');
  });

  it('returns empty string for null input', () => {
    expect(toISODate(null)).toBe('');
  });
});

describe('toResponseDate', () => {
  it('appends +08:00 to ISO date', () => {
    expect(toResponseDate('2026-08-15')).toBe('2026-08-15+08:00');
  });

  it('returns empty string for empty input', () => {
    expect(toResponseDate('')).toBe('');
  });
});

describe('parseHKJCFixtures', () => {
  const fixture = {
    data: {
      item: {
        years: [
          {
            year: '2026',
            months: [
              { month: { value: '9' }, dates: { date: [{ value: '26' }, { value: '05' }, { value: '08' }] } },
              { month: { value: '10' }, dates: { date: [{ value: '03' }, { value: '06' }] } },
            ],
          },
          { year: '2027', months: [{ month: { value: '1' }, dates: { date: [{ value: '02' }] } }] },
        ],
      },
    },
  };

  it('flattens years/months into sorted YYYY-MM-DD dates', () => {
    expect(parseHKJCFixtures(fixture)).toEqual([
      '2026-09-05', '2026-09-08', '2026-09-26', '2026-10-03', '2026-10-06', '2027-01-02',
    ]);
  });

  it('pads single-digit months and days', () => {
    expect(parseHKJCFixtures(fixture)).toContain('2027-01-02');
    expect(parseHKJCFixtures(fixture)).toContain('2026-10-06');
  });

  it('skips malformed months and dates', () => {
    const messy = {
      data: {
        item: {
          years: [
            {
              year: '2026',
              months: [
                { month: { value: '9' }, dates: { date: [{ value: '10' }, { value: 'xx' }, null] } },
                { month: { value: '9' }, dates: null },
                { month: null, dates: { date: [{ value: '11' }] } },
                {},
              ],
            },
            {},
          ],
        },
      },
    };
    expect(parseHKJCFixtures(messy)).toEqual(['2026-09-10']);
  });

  it('returns [] for missing or empty payloads', () => {
    expect(parseHKJCFixtures(null)).toEqual([]);
    expect(parseHKJCFixtures({})).toEqual([]);
    expect(parseHKJCFixtures({ data: {} })).toEqual([]);
    expect(parseHKJCFixtures({ data: { item: { years: [] } } })).toEqual([]);
  });
});

describe('upcomingDrawDates', () => {
  const nowMs = Date.parse('2026-09-30T04:00:00Z'); // 12:00 HKT

  it('drops past dates and keeps today or later', () => {
    expect(upcomingDrawDates(['2026-09-26', '2026-09-30', '2026-10-03'], nowMs))
      .toEqual(['2026-09-30', '2026-10-03']);
  });

  it('caps the result at the limit', () => {
    const dates = Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    expect(upcomingDrawDates(dates, nowMs, 3)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('defaults to 8 entries', () => {
    const dates = Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    expect(upcomingDrawDates(dates, nowMs)).toHaveLength(8);
  });

  it('handles missing input', () => {
    expect(upcomingDrawDates(undefined, nowMs)).toEqual([]);
    expect(upcomingDrawDates(null, nowMs)).toEqual([]);
    expect(upcomingDrawDates([], nowMs)).toEqual([]);
  });
});
