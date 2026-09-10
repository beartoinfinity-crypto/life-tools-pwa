const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_KEY in environment variables');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function createDB() {
  return {
    async count() {
      const { count, error } = await supabase
        .from('draws')
        .select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count || 0;
    },

    async upsert(draw) {
      const { error } = await supabase
        .from('draws')
        .upsert({
          draw: draw.draw,
          date: draw.date,
          numbers: JSON.stringify(draw.numbers),
          special: draw.special,
          source: draw.source || null
        }, { onConflict: 'draw' });
      if (error) throw error;
    },

    async upsertBatch(draws) {
      const { error } = await supabase
        .from('draws')
        .upsert(
          draws.map(d => ({
            draw: d.draw,
            date: d.date,
            numbers: JSON.stringify(d.numbers),
            special: d.special,
            source: d.source || null
          })),
          { onConflict: 'draw' }
        );
      if (error) throw error;
    },

    async getDraws(limit) {
      const { data, error } = await supabase
        .from('draws')
        .select('*')
        .order('date', { ascending: false })
        .order('draw', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data.map(r => ({ ...r, numbers: JSON.parse(r.numbers) }));
    },

    async getDrawsByYear(year) {
      const { data, error } = await supabase
        .from('draws')
        .select('*')
        .like('date', `${year}-%`)
        .order('date', { ascending: false })
        .order('draw', { ascending: false });
      if (error) throw error;
      return data.map(r => ({ ...r, numbers: JSON.parse(r.numbers) }));
    },

    async getDrawsRange(from, to) {
      let query = supabase
        .from('draws')
        .select('*')
        .order('date', { ascending: false })
        .order('draw', { ascending: false });

      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);

      const { data, error } = await query;
      if (error) throw error;
      return data.map(r => ({ ...r, numbers: JSON.parse(r.numbers) }));
    },

    async metaGet(key) {
      const { data, error } = await supabase
        .from('meta')
        .select('value')
        .eq('key', key)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data ? data.value : null;
    },

    async metaSet(key, value) {
      const { error } = await supabase
        .from('meta')
        .upsert({ key, value }, { onConflict: 'key' });
      if (error) throw error;
    },

    async close() {
      // Supabase client doesn't need explicit close
    }
  };
}

module.exports = { createDB, supabase };
