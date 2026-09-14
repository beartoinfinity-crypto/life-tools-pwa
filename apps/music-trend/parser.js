/**
 * Classifier + normalizer for the Apple Music HK "most played" RSS feed
 * (https://rss.applemarketingtools.com/api/v2/hk/music/most-played/100/songs.json).
 *
 * Each result carries genres; the primary (first) genre decides the language
 * playlist membership:
 *   - Cantonese: genreId 1251 / name ~ 廣東歌/香港流行樂
 *   - Mandarin:  genreId 1252 / name ~ 國語流行樂/華語 (also C-pop, Mandopop)
 *   - otherwise (K-pop, plain 流行樂, Hip-Hop…): trending only.
 */

const FEED_URL = 'https://rss.applemarketingtools.com/api/v2/hk/music/most-played/100/songs.json';

/** Apple "most played" feed for a country code (hk, tw, cn, jp, kr, us, ...). */
function feedUrl(country) {
  const cc = String(country || 'hk').toLowerCase();
  return `https://rss.applemarketingtools.com/api/v2/${cc}/music/most-played/100/songs.json`;
}

const CANTO_RE = /廣東|香港流行|canton/i;
const MANDO_RE = /國語|華語|普通話|mandopop|c-pop|chinese pop/i;

function isCantonese(song) {
  const g = song.genres && song.genres[0];
  return !!g && (g.genreId === '1251' || CANTO_RE.test(g.name || ''));
}

function isMandarin(song) {
  const g = song.genres && song.genres[0];
  return !!g && (g.genreId === '1252' || MANDO_RE.test(g.name || ''));
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
 * Build the three playlists from a feed payload (already JSON.parsed).
 * Returns { trending: [...], cantonese: [...], chinese: [...], updatedAt, chartTitle }
 */
function buildPlaylists(feed) {
  const results = (feed && feed.feed && feed.feed.results) || [];
  const songs = results.map((s, i) => toSong(s, i + 1));
  const pick = (fn) => results.filter(fn).map((s) => toSong(s, results.indexOf(s) + 1));
  return {
    chartTitle: (feed && feed.feed && feed.feed.title) || '熱門歌曲',
    updatedAt: (feed && feed.feed && feed.feed.updated) || '',
    trending: songs,
    cantonese: pick(isCantonese),
    chinese: pick(isMandarin)
  };
}

module.exports = { buildPlaylists, isCantonese, isMandarin, FEED_URL, feedUrl };