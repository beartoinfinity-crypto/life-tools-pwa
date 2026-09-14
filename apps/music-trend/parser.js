/**
 * Classifier for the Apple Music "most played" RSS feeds.
 *
 * Each result carries genres; the primary (first) genre picks the playlist
 * for HK/TW where Apple tags them:
 *   - Cantonese: genreId 1251 / name ~ 廣東歌/香港流行樂
 *   - Mandarin:  genreId 1252 / TW genreId 1253 / name ~ 國語流行樂/華語/Mandopop
 * Other regions (CN, SG, KR…) don't tag Cantonese/Mandarin, so falls back to
 * the song-title language: Chinese characters in the title decide membership,
 * with Cantonese-only characters (嘅咗唔喺嗰啲冇…) marking 廣東歌.
 */

const FEED_URL = 'https://rss.applemarketingtools.com/api/v2/hk/music/most-played/100/songs.json';

/** Apple "most played" feed for a country code (hk, tw, cn, jp, kr, us, ...). */
function feedUrl(country) {
  const cc = String(country || 'hk').toLowerCase();
  return `https://rss.applemarketingtools.com/api/v2/${cc}/music/most-played/100/songs.json`;
}

const CANTO_RE = /廣東|香港流行|粵語|canton/i;
const MANDO_RE = /國語|華語|普通話|mandopop|c-pop|chinese pop|华语|国语|普通话/i;

// Chinese characters (CJK unified + extension + radicals/symbols)
const CJK_RE = /[\u2E80-\u2EFF\u3400-\u4DBF\u4E00-\u9FFF]/;
// Hiragana + Katakana: presence means the title is Japanese, not Chinese
const JAPANESE_KANA_RE = /[\u3040-\u30FF]/;
// Cantonese-only colloquial characters: effectively never appear in a
// standard Mandarin title, so a title containing one is 廣東歌.
const CANTO_TITLE_MARKERS = ['嘅', '咗', '喺', '嗰', '啲', '冇', '哋', '佢', '乜', '咁', '咩', '唔'];

function titleIsChinese(name) {
  if (!CJK_RE.test(name)) return false;
  if (JAPANESE_KANA_RE.test(name)) return false; // has kana => Japanese, skip
  return true;
}

function isCantonese(song) {
  const g = song.genres && song.genres[0];
  if (g && (String(g.genreId) === '1251' || CANTO_RE.test(String(g.name || '')))) return true;
  const name = String(song.name || '');
  if (!titleIsChinese(name)) return false;
  return CANTO_TITLE_MARKERS.some((m) => name.indexOf(m) >= 0);
}

function isMandarin(song) {
  const g = song.genres && song.genres[0];
  if (g && (String(g.genreId) === '1252' || MANDO_RE.test(String(g.name || '')))) return true;
  const name = String(song.name || '');
  if (!titleIsChinese(name)) return false;
  return !CANTO_TITLE_MARKERS.some((m) => name.indexOf(m) >= 0);
}

/** feed result -> compact song record */
function toSong(s, rank) {
  return {
    rank,
    id: String(s.id || ''),
    name: s.name || '',
    artist: s.artistName || '',
    artistUrl: s.artistUrl || '',
    artwork: s.artworkUrl100 || '',
    releaseDate: s.releaseDate || '',
    genre: (s.genres && s.genres[0] && s.genres[0].name) || ''
  };
}

/**
 * Countries that actually have a Cantonese / Mandarin scene in their Apple
 * most-played chart. Everywhere else the 廣東歌/國語歌 tags don't apply, so we
 * don't build (or show) those playlists at all:
 *   - 廣東歌  -> Hong Kong only
 *   - 國語歌  -> HK, TW, CN, SG
 */
export const CANTO_COUNTRIES = new Set(['hk']);
export const MANDO_COUNTRIES = new Set(['hk', 'tw', 'cn', 'sg']);

/**
 * Build the three playlists from a feed payload (already JSON.parsed) for a
 * country. 廣東歌/國語歌 are only built for the countries that have that scene
 * (see CANTO_COUNTRIES / MANDO_COUNTRIES); everywhere else those lists are [].
 * Returns { trending: [...], cantonese: [...], chinese: [...], updatedAt, chartTitle }
 */
function buildPlaylists(feed, country) {
  const cc = String(country || 'hk').toLowerCase();
  const results = (feed && feed.feed && feed.feed.results) || [];
  const songs = results.map((s, i) => toSong(s, i + 1));
  const pick = (fn) => results.filter(fn).map((s) => toSong(s, results.indexOf(s) + 1));
  return {
    chartTitle: (feed && feed.feed && feed.feed.title) || '熱門歌曲',
    updatedAt: (feed && feed.feed && feed.feed.updated) || '',
    trending: songs,
    cantonese: CANTO_COUNTRIES.has(cc) ? pick(isCantonese) : [],
    chinese: MANDO_COUNTRIES.has(cc) ? pick(isMandarin) : []
  };
}

module.exports = { buildPlaylists, isCantonese, isMandarin, FEED_URL, feedUrl };