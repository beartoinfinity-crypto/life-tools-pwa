const Database = require('better-sqlite3');
const path = require('path');

function createDB(dbPath) {
  const db = new Database(dbPath || ':memory:');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS draws (
      draw TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      numbers TEXT NOT NULL,
      special INTEGER,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_date ON draws(date);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  return {
    db,

    count() {
      return db.prepare('SELECT COUNT(*) as cnt FROM draws').get().cnt;
    },

    upsert(draw) {
      db.prepare('INSERT OR REPLACE INTO draws (draw, date, numbers, special, source) VALUES (?, ?, ?, ?, ?)')
        .run(draw.draw, draw.date, JSON.stringify(draw.numbers), draw.special, draw.source || null);
    },

    upsertBatch(draws) {
      const tx = db.transaction((items) => {
        for (const d of items) {
          db.prepare('INSERT OR REPLACE INTO draws (draw, date, numbers, special, source) VALUES (?, ?, ?, ?, ?)')
            .run(d.draw, d.date, JSON.stringify(d.numbers), d.special, d.source || null);
        }
      });
      tx(draws);
    },

    getDraws(limit) {
      const rows = db.prepare('SELECT * FROM draws ORDER BY date DESC, draw DESC LIMIT ?').all(limit);
      return rows.map(r => ({ ...r, numbers: JSON.parse(r.numbers) }));
    },

    getDrawsByYear(year) {
      const rows = db.prepare("SELECT * FROM draws WHERE date LIKE ? ORDER BY date DESC, draw DESC").all(`${year}-%`);
      return rows.map(r => ({ ...r, numbers: JSON.parse(r.numbers) }));
    },

    getDrawsRange(from, to) {
      const rows = db.prepare('SELECT * FROM draws ORDER BY date DESC, draw DESC').all();
      return rows.filter(d => {
        if (from && d.date < from) return false;
        if (to && d.date > to) return false;
        return true;
      }).map(r => ({ ...r, numbers: JSON.parse(r.numbers) }));
    },

    metaGet(key) {
      const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
      return row ? row.value : null;
    },

    metaSet(key, value) {
      db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
    },

    close() {
      db.close();
    }
  };
}

module.exports = { createDB };
