require('dotenv').config();
const app = require('./app');
const { ensureInitialData } = require('./apps/mark-six/server');
const { refreshTrafficNews } = require('./apps/traffic-news/server');

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Life Tool server running at http://localhost:${PORT}`);
  console.log('  Dashboard:  /');
  console.log('  Mark Six:     /mark-six/');
  console.log('  HK Bus ETA:   /bus-eta/      (upstream)');
  console.log('  HK Bus Lite:  /bus-eta-lite/');
  console.log('  Traffic News: /traffic-news/api/news');
  console.log('  Music Trend:  /music-trend/api/playlists');
  await ensureInitialData();

  // Traffic news: scrape now, then refresh every minute
  refreshTrafficNews().catch((e) => console.log('traffic news refresh failed:', e.message));
  const timer = setInterval(() => {
    refreshTrafficNews().catch((e) => console.log('traffic news refresh failed:', e.message));
  }, 60 * 1000);
  timer.unref && timer.unref();

  // Music trend: scrape all countries at boot, then hourly round-robin
  // (one country per 6-minute tick so bursts stay small)
  const { refreshMusicTrend, COUNTRIES, validateYouTubeIds } = require('./apps/music-trend/server');
  const ccs = Object.keys(COUNTRIES);
  const refreshCc = (cc) => refreshMusicTrend(cc).catch((e) => console.log(`music trend ${cc} refresh failed:`, e.message));
  (async () => {
    for (const cc of ccs) await refreshCc(cc);
  })();
  let rr = 0;
  const mtTimer = setInterval(() => {
    refreshCc(ccs[rr % ccs.length]);
    rr++;
  }, 6 * 60 * 1000);
  mtTimer.unref && mtTimer.unref();

  // YouTube link health: even when the Apple feed is fine/failing independently,
  // re-check a rolling window of cached ids and re-search dead ones. Runs off
  // the Supabase cache only (no scrape), one country per tick, so it survives
  // Apple outages and never hammers YouTube.
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const validateCc = async (cc) => {
    try {
      const { data: row, error } = await supabase
        .from('music_trend')
        .select('songs')
        .eq('list', `${cc}:trending`)
        .maybeSingle();
      if (error || !row) return;
      const songs = JSON.parse(row.songs || '[]');
      const stats = await validateYouTubeIds(songs, { limit: 15, maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
      if (!stats.checked && !stats.fixed && !stats.cleared) return;
      if (stats.fixed || stats.cleared) {
        // Persist fixes + mirror to cantonese/chinese (same song objects by id)
        const byId = new Map(songs.map((s) => [String(s.id), s]));
        const rows = [{ list: `${cc}:trending`, songs: JSON.stringify(songs) }];
        for (const ln of ['cantonese', 'chinese']) {
          const { data: other } = await supabase.from('music_trend').select('songs').eq('list', `${cc}:${ln}`).maybeSingle();
          if (!other) continue;
          const arr = JSON.parse(other.songs || '[]');
          let touched = false;
          for (const s of arr) {
            const src = byId.get(String(s.id));
            if (!src) continue;
            if (src.youtubeId) {
              if (s.youtubeId !== src.youtubeId || s.youtubeTitle !== src.youtubeTitle || s.youtubeCheckedAt !== src.youtubeCheckedAt) {
                s.youtubeId = src.youtubeId;
                s.youtubeTitle = src.youtubeTitle;
                if (src.youtubeCheckedAt) s.youtubeCheckedAt = src.youtubeCheckedAt;
                touched = true;
              }
            } else if (s.youtubeId) {
              delete s.youtubeId;
              delete s.youtubeTitle;
              delete s.youtubeCheckedAt;
              touched = true;
            }
          }
          if (touched) rows.push({ list: `${cc}:${ln}`, songs: JSON.stringify(arr) });
        }
        await supabase.from('music_trend').upsert(rows, { onConflict: 'list' });
      } else if (stats.checked) {
        // Only stamps advanced — write back the trending row
        await supabase.from('music_trend').update({ songs: JSON.stringify(songs) }).eq('list', `${cc}:trending`);
      }
      console.log(`music trend ${cc} yt-validate:`, JSON.stringify(stats));
    } catch (e) {
      console.log(`music trend ${cc} yt-validate failed:`, e.message);
    }
  };
  let vr = 0;
  const ytValTimer = setInterval(() => {
    validateCc(ccs[vr % ccs.length]);
    vr++;
  }, 30 * 60 * 1000); // one country every 30 min → full cycle ~5 h
  ytValTimer.unref && ytValTimer.unref();
});