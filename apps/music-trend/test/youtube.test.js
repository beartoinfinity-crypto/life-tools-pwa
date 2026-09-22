import { describe, it, expect } from 'vitest';
import {
  extractFirstVideo,
  extractVideos,
  pickOfficialMV,
  mapLimit,
  classifyOembedStatus,
  needsYtRevalidate,
  validateYouTubeId,
  validateYouTubeIds
} from '../youtube.js';

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

describe('extractVideos', () => {
  it('extracts multiple videoRenderer blocks', () => {
    const html =
      '{"videoRenderer":{"videoId":"aaa11111111","title":{"runs":[{"text":"Song A official MV"}]},"longBylineText":{"runs":[{"text":"Artist VEVO"}]}}}' +
      '{"videoRenderer":{"videoId":"bbb22222222","title":{"runs":[{"text":"Song A live performance"}]},"longBylineText":{"runs":[{"text":"Fan Channel"}]}}}';
    const videos = extractVideos(html);
    expect(videos).toHaveLength(2);
    expect(videos[0].videoId).toBe('aaa11111111');
    expect(videos[0].channel).toBe('Artist VEVO');
    expect(videos[1].videoId).toBe('bbb22222222');
  });

  it('returns empty array when no results', () => {
    expect(extractVideos('<html>nothing</html>')).toEqual([]);
  });
});

describe('pickOfficialMV', () => {
  const videos = [
    { videoId: 'v1', title: 'Song A (Official Music Video)', channel: 'Artist VEVO' },
    { videoId: 'v2', title: 'Song A live performance', channel: 'Fan Channel' },
    { videoId: 'v3', title: 'Song A cover', channel: 'Cover Artist' },
  ];

  it('picks the official MV when present', () => {
    const best = pickOfficialMV(videos, 'Song A');
    expect(best).not.toBeNull();
    expect(best.videoId).toBe('v1');
  });

  it('returns null when no video scores >= 5', () => {
    const low = [
      { videoId: 'x1', title: 'random video', channel: 'some channel' },
    ];
    expect(pickOfficialMV(low, 'Song A')).toBeNull();
  });

  it('prefers vevo channel even without "official" in title', () => {
    const vevoOnly = [
      { videoId: 'v4', title: 'Song B mv', channel: 'Artist VEVO' },
      { videoId: 'v5', title: 'Song B official video', channel: 'Random Channel' },
    ];
    const best = pickOfficialMV(vevoOnly, 'Song B');
    expect(best.videoId).toBe('v4');
  });

  it('returns null for empty input', () => {
    expect(pickOfficialMV([], 'Song A')).toBeNull();
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

describe('classifyOembedStatus', () => {
  it('treats 200 as ok', () => {
    expect(classifyOembedStatus(200)).toBe('ok');
  });

  it('treats deleted / missing / private as dead', () => {
    expect(classifyOembedStatus(400)).toBe('dead');
    expect(classifyOembedStatus(404)).toBe('dead');
    expect(classifyOembedStatus(401)).toBe('dead');
  });

  it('treats rate-limits and server errors as unknown (keep the id)', () => {
    expect(classifyOembedStatus(403)).toBe('unknown');
    expect(classifyOembedStatus(429)).toBe('unknown');
    expect(classifyOembedStatus(500)).toBe('unknown');
    expect(classifyOembedStatus(503)).toBe('unknown');
  });
});

describe('needsYtRevalidate', () => {
  const now = Date.parse('2026-09-22T00:00:00Z');
  const week = 7 * 24 * 60 * 60 * 1000;

  it('never revalidates songs with no youtubeId', () => {
    expect(needsYtRevalidate({ id: 's1' }, now, week)).toBe(false);
    expect(needsYtRevalidate({ id: 's1', youtubeId: '' }, now, week)).toBe(false);
  });

  it('revalidates when never checked', () => {
    expect(needsYtRevalidate({ id: 's1', youtubeId: 'abcdefghijk' }, now, week)).toBe(true);
  });

  it('revalidates when checkedAt is stale', () => {
    const song = { youtubeId: 'abcdefghijk', youtubeCheckedAt: '2026-09-01T00:00:00.000Z' };
    expect(needsYtRevalidate(song, now, week)).toBe(true);
  });

  it('skips when checkedAt is fresh', () => {
    const song = { youtubeId: 'abcdefghijk', youtubeCheckedAt: '2026-09-21T00:00:00.000Z' };
    expect(needsYtRevalidate(song, now, week)).toBe(false);
  });

  it('treats unparsable checkedAt as stale', () => {
    const song = { youtubeId: 'abcdefghijk', youtubeCheckedAt: 'not-a-date' };
    expect(needsYtRevalidate(song, now, week)).toBe(true);
  });

  it('maxAgeMs 0 means always revalidate', () => {
    const song = { youtubeId: 'abcdefghijk', youtubeCheckedAt: new Date(now).toISOString() };
    expect(needsYtRevalidate(song, now, 0)).toBe(true);
  });
});

describe('validateYouTubeId', () => {
  it('rejects malformed ids without a network call', async () => {
    expect(await validateYouTubeId('')).toEqual({ ok: false });
    expect(await validateYouTubeId('short')).toEqual({ ok: false });
    expect(await validateYouTubeId('bad!chars??')).toEqual({ ok: false });
    expect(await validateYouTubeId(null)).toEqual({ ok: false });
  });
});

describe('validateYouTubeIds', () => {
  const checkOk = async () => ({ ok: true });
  const checkDead = async () => ({ ok: false });
  const checkUnknown = async () => ({ ok: null });
  const searchNull = async () => null;

  it('skips songs that are freshly checked or have no id', async () => {
    const now = Date.parse('2026-09-22T00:00:00Z');
    const songs = [
      { id: 'a', name: 'A', artist: 'X' }, // no id
      { id: 'b', name: 'B', artist: 'Y', youtubeId: 'bbbbbbbbbbb', youtubeCheckedAt: new Date(now - 1000).toISOString() }
    ];
    const stats = await validateYouTubeIds(songs, {
      now,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      check: checkOk,
      search: searchNull
    });
    expect(stats).toEqual({ candidates: 0, checked: 0, fixed: 0, cleared: 0 });
  });

  it('stamps checkedAt on alive ids', async () => {
    const songs = [{ id: 'a', name: 'Alive', artist: 'X', youtubeId: 'alivealive1' }];
    const stats = await validateYouTubeIds(songs, { limit: 10, maxAgeMs: 0, check: checkOk, search: searchNull });
    expect(stats).toEqual({ candidates: 1, checked: 1, fixed: 0, cleared: 0 });
    expect(songs[0].youtubeCheckedAt).toBeTruthy();
    expect(songs[0].youtubeId).toBe('alivealive1');
  });

  it('clears a dead id and re-searches when a replacement is found', async () => {
    const songs = [{ id: 'b', name: 'Broken', artist: 'Y', youtubeId: 'deaddeaddead' }];
    const stats = await validateYouTubeIds(songs, {
      limit: 10,
      maxAgeMs: 0,
      check: checkDead,
      search: async () => ({ videoId: 'newnewnew123', title: 'Fixed' })
    });
    expect(stats).toEqual({ candidates: 1, checked: 1, fixed: 1, cleared: 0 });
    expect(songs[0].youtubeId).toBe('newnewnew123');
    expect(songs[0].youtubeTitle).toBe('Fixed');
    expect(songs[0].youtubeCheckedAt).toBeTruthy();
  });

  it('clears the id when re-search also fails', async () => {
    const songs = [{ id: 'b', name: 'Broken', artist: 'Y', youtubeId: 'gone00000000' }];
    const stats = await validateYouTubeIds(songs, { limit: 10, maxAgeMs: 0, check: checkDead, search: searchNull });
    expect(stats.cleared).toBe(1);
    expect(songs[0].youtubeId).toBeUndefined();
    expect(songs[0].youtubeCheckedAt).toBeTruthy();
  });

  it('leaves the id alone (and does not stamp) when oEmbed is unknown', async () => {
    const songs = [{ id: 'a', name: 'Flaky', artist: 'X', youtubeId: 'flakyflaky1' }];
    const stats = await validateYouTubeIds(songs, { limit: 10, maxAgeMs: 0, check: checkUnknown, search: searchNull });
    expect(stats.checked).toBe(0);
    expect(songs[0].youtubeId).toBe('flakyflaky1');
    expect(songs[0].youtubeCheckedAt).toBeUndefined();
  });

  it('respects the limit (rolling window)', async () => {
    const songs = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      name: `S${i}`,
      artist: 'A',
      youtubeId: `vid${String(i).padStart(8, '0')}`
    }));
    const stats = await validateYouTubeIds(songs, { limit: 3, maxAgeMs: 0, check: checkOk, search: searchNull });
    expect(stats.candidates).toBe(10);
    expect(stats.checked).toBe(3);
  });

  it('prefers never-checked songs over stale-checked ones when sorting', async () => {
    const now = Date.parse('2026-09-22T00:00:00Z');
    const stale = '2026-01-01T00:00:00.000Z';
    const songs = [
      { id: 'z', name: 'Stale', artist: 'A', youtubeId: 'stalestale1', youtubeCheckedAt: stale },
      { id: 'a', name: 'FreshNever', artist: 'B', youtubeId: 'nevercheck1' }
    ];
    const seen = [];
    await validateYouTubeIds(songs, {
      limit: 1,
      now,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      check: async (id) => { seen.push(id); return { ok: true }; },
      search: searchNull
    });
    expect(seen).toEqual(['nevercheck1']);
  });
});