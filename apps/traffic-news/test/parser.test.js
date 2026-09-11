import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoutejamNews, toHKISO, extractCoords } from '../parser.js';

const html = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'news.html'),
  'utf8'
);

describe('toHKISO', () => {
  it('converts 下午 times to 24h +08:00', () => {
    expect(toHKISO('2026年9月11日 下午02:58')).toBe('2026-09-11T14:58:00+08:00');
  });
  it('converts 上午 times to 24h +08:00', () => {
    expect(toHKISO('2026年9月11日 上午08:16')).toBe('2026-09-11T08:16:00+08:00');
  });
  it('treats 下午12:xx as noon', () => {
    expect(toHKISO('2026年9月11日 下午12:56')).toBe('2026-09-11T12:56:00+08:00');
  });
  it('treats 上午12:xx as midnight', () => {
    expect(toHKISO('2026年9月11日 上午12:05')).toBe('2026-09-11T00:05:00+08:00');
  });
  it('returns null for unparseable input', () => {
    expect(toHKISO('nonsense')).toBeNull();
  });
});

describe('extractCoords', () => {
  it('maps item ids to lat/lng from the collapse handler blocks', () => {
    const coords = extractCoords(html);
    expect(coords.get('abc123')).toEqual({ lat: 22.3177553599667, lng: 114.159893278781 });
    expect(coords.get('RD#deadbeef')).toEqual({ lat: 22.2854080198983, lng: 114.156805854919 });
  });
  it('ignores the legacy #collapseOne handler, initMap center and the trailing bare marker block', () => {
    const coords = extractCoords(html);
    expect(coords.has('One')).toBe(false);
    expect(coords.size).toBe(2);
  });
});

describe('parseRoutejamNews', () => {
  const items = parseRoutejamNews(html);

  it('parses every accordion item', () => {
    expect(items).toHaveLength(4);
  });

  it('extracts the fields of a latest RTHK item with direction', () => {
    const i = items.find((x) => x.id === 'abc123');
    expect(i.postedAt).toBe('2026-09-11T14:58:00+08:00');
    expect(i.relative).toBe('4分鐘前');
    expect(i.category).toBe('道路事故-交通意外');
    expect(i.status).toBe('最新情況');
    expect(i.location).toBe('西九龍公路,奧運港鐵站 [往西隧]');
    expect(i.detail).toBe('較早前西九龍公路往西隧方向，近奧運港鐵站的交通意外清場。');
    expect(i.source).toBe('香港電台');
    expect(i.lat).toBeCloseTo(22.3177553599667);
    expect(i.lng).toBeCloseTo(114.159893278781);
  });

  it('extracts multi-paragraph details with an RD# id', () => {
    const i = items.find((x) => x.id === 'RD#deadbeef');
    expect(i.status).toBe('完結');
    expect(i.location).toBe('干諾道西');
    expect(i.detail).toBe('以下路段的交通現已恢復正常:\n–龍富路(往龍鼓灘方向)。');
    expect(i.source).toBe('https://data.gov.hk/');
    expect(i.postedAt).toBe('2026-09-11T08:16:00+08:00');
  });

  it('keeps footnote lines after 資料來源 as part of the detail (DS- items)', () => {
    const i = items.find((x) => x.id.startsWith('DS-'));
    expect(i.source).toBe('Routejam');
    expect(i.detail).toContain('根據系統分析');
    expect(i.detail).toContain('(*此信號是通過分析政府提供的行車速度計所得)');
  });

  it('handles empty location and missing coordinates', () => {
    const i = items.find((x) => x.id === 'IN-26-06664');
    expect(i.location).toBe('');
    expect(i.lat).toBeNull();
    expect(i.lng).toBeNull();
    expect(i.detail).toContain('大網仔路間歇性封閉');
  });
});