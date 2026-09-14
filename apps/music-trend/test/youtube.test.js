import { describe, it, expect } from 'vitest';
import { extractFirstVideo, mapLimit } from '../youtube.js';

describe('extractFirstVideo', () => {
  it('extracts the first videoRenderer id and title', () => {
    const html = 'xx{"videoRenderer":{"videoId":"falq0Gr3rc0","thumbnail":{},"title":{"runs":[{"text":"gareth.t - 用背脊唱情歌 (official video)"}]}}}yy';
    expect(extractFirstVideo(html)).toEqual({
      videoId: 'falq0Gr3rc0',
      title: 'gareth.t - 用背脊唱情歌 (official video)'
    });
  });

  it('decodes escaped characters in titles', () => {
    const html = '{"videoRenderer":{"videoId":"abc12345678","title":{"runs":[{"text":"song \\u0022quoted\\u0022 live"}]}}}';
    expect(extractFirstVideo(html)).toEqual({ videoId: 'abc12345678', title: 'song "quoted" live' });
  });

  it('returns null when no videoRenderer exists', () => {
    expect(extractFirstVideo('<html>no results</html>')).toBeNull();
  });

  it('returns an id with empty title when the title block is missing', () => {
    const html = '{"videoRenderer":{"videoId":"abcdEFGH123"}}';
    expect(extractFirstVideo(html)).toEqual({ videoId: 'abcdEFGH123', title: '' });
  });
});

describe('mapLimit', () => {
  it('maps all items in order with bounded concurrency', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    const out = await mapLimit(items, 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('tolerates fewer items than the limit and empty input', async () => {
    expect(await mapLimit([1, 2], 5, async (n) => n + 1)).toEqual([2, 3]);
    expect(await mapLimit([], 5, async (n) => n)).toEqual([]);
  });

  it('keeps nulls for failed items (does not reject)', async () => {
    const out = await mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(out[0]).toBe(1);
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBe(3);
  });
});