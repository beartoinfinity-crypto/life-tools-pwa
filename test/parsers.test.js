const fs = require('fs');
const path = require('path');
const {
  parseLotteryExtreme,
  parseLotteryHk,
  parseGitHubData,
  toISODate,
  toResponseDate,
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
