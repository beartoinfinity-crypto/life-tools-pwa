import { describe, it, expect } from 'vitest';
import { buildPlaylists, isCantonese, isMandarin } from '../parser.js';

const song = (over) => ({
  id: '1',
  name: 'Song',
  artistName: 'Artist',
  artistUrl: 'https://music.apple.com/hk/artist/x/1',
  artworkUrl100: 'https://example.com/100x100bb.jpg',
  releaseDate: '2026-01-01',
  genres: [{ genreId: '1251', name: '廣東歌/香港流行樂' }],
  ...over
});

const feed = (results) => ({
  feed: {
    title: '熱門歌曲',
    updated: 'Mon, 14 Sep 2026 01:51:37 +0000',
    results
  }
});

describe('genre classification', () => {
  it('classifies Cantonese by genreId 1251', () => {
    expect(isCantonese(song({ genres: [{ genreId: '1251', name: 'x' }] }))).toBe(true);
  });
  it('classifies Cantonese by genre name 廣東/香港流行', () => {
    expect(isCantonese(song({ genres: [{ genreId: '9', name: '廣東歌/香港流行樂' }] }))).toBe(true);
  });
  it('classifies Mandarin by genreId 1252', () => {
    expect(isMandarin(song({ genres: [{ genreId: '1252', name: 'x' }] }))).toBe(true);
  });
  it('classifies Mandarin by genre name 國語/華語', () => {
    expect(isMandarin(song({ genres: [{ genreId: '9', name: '國語流行樂' }] }))).toBe(true);
    expect(isMandarin(song({ genres: [{ genreId: '9', name: 'Mandopop' }] }))).toBe(true);
  });
  it('leaves K-pop / generic pop in trending only', () => {
    const kpop = song({ genres: [{ genreId: '1234', name: '韓國流行樂' }] });
    expect(isCantonese(kpop)).toBe(false);
    expect(isMandarin(kpop)).toBe(false);
    const generic = song({ genres: [{ genreId: '14', name: '流行樂' }] });
    expect(isCantonese(generic)).toBe(false);
    expect(isMandarin(generic)).toBe(false);
  });
  it('tolerates missing genres', () => {
    const none = song({ genres: undefined });
    expect(isCantonese(none)).toBe(false);
    expect(isMandarin(none)).toBe(false);
  });
});

describe('buildPlaylists', () => {
  const lists = buildPlaylists(feed([
    song({ id: 'a', name: 'Canto1' }),
    song({ id: 'b', name: 'Mando1', genres: [{ genreId: '1252', name: '國語流行樂' }] }),
    song({ id: 'c', name: 'Kpop1', genres: [{ genreId: '1234', name: '韓國流行樂' }] }),
    song({ id: 'd', name: 'Canto2', genres: [{ genreId: '1251', name: '廣東歌/香港流行樂' }] })
  ]));

  it('trending holds every song in chart order with ranks', () => {
    expect(lists.trending.map((s) => s.name)).toEqual(['Canto1', 'Mando1', 'Kpop1', 'Canto2']);
    expect(lists.trending.map((s) => s.rank)).toEqual([1, 2, 3, 4]);
  });
  it('cantonese and chinese playlists are filtered by primary genre', () => {
    expect(lists.cantonese.map((s) => s.name)).toEqual(['Canto1', 'Canto2']);
    expect(lists.chinese.map((s) => s.name)).toEqual(['Mando1']);
  });
  it('keeps song fields compact', () => {
    const s = lists.trending[0];
    expect(s).toMatchObject({ rank: 1, id: 'a', name: 'Canto1', artist: 'Artist', genre: '廣東歌/香港流行樂' });
    expect(s.artwork).toContain('100x100bb');
  });
  it('carries chart title and source updated time', () => {
    expect(lists.chartTitle).toBe('熱門歌曲');
    expect(lists.updatedAt).toBe('Mon, 14 Sep 2026 01:51:37 +0000');
  });
  it('handles an empty feed', () => {
    const empty = buildPlaylists(feed([]));
    expect(empty.trending).toEqual([]);
    expect(empty.cantonese).toEqual([]);
    expect(empty.chinese).toEqual([]);
  });
});