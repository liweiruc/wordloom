import type { DB } from './types'

// Each entry upgrades the schema by one version; PRAGMA user_version records how many have
// run. Shipped entries are never edited: a database already at that version would skip the
// change, so every later change goes in a new entry.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE words (
    id INTEGER PRIMARY KEY,
    headword TEXT NOT NULL,
    norm TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'word',
    ipa_uk TEXT NOT NULL DEFAULT '',
    ipa_us TEXT NOT NULL DEFAULT '',
    variants TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    llm_model TEXT,
    prompt_version INTEGER,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    enriched_at INTEGER
  );
  CREATE INDEX idx_words_status ON words(status);

  CREATE TABLE senses (
    id INTEGER PRIMARY KEY,
    word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    ord INTEGER NOT NULL,
    pos TEXT NOT NULL,
    def_en TEXT NOT NULL,
    def_zh TEXT NOT NULL,
    register TEXT NOT NULL DEFAULT 'neutral',
    user_edited INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_senses_word ON senses(word_id, ord);

  -- One example per sense for now. A table of its own leaves room for giving mature cards
  -- sentences they have not been asked with yet.
  CREATE TABLE examples (
    id INTEGER PRIMARY KEY,
    sense_id INTEGER NOT NULL REFERENCES senses(id) ON DELETE CASCADE,
    ord INTEGER NOT NULL DEFAULT 0,
    en TEXT NOT NULL,
    zh TEXT NOT NULL,
    cloze TEXT NOT NULL
  );
  CREATE INDEX idx_examples_sense ON examples(sense_id, ord);

  -- One card per sense. The FSRS columns mirror ts-fsrs's Card; word_id is duplicated from
  -- the sense so the daily queue can keep a word's senses off the same day cheaply.
  CREATE TABLE cards (
    id INTEGER PRIMARY KEY,
    sense_id INTEGER NOT NULL UNIQUE REFERENCES senses(id) ON DELETE CASCADE,
    word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    due INTEGER NOT NULL,
    stability REAL NOT NULL DEFAULT 0,
    difficulty REAL NOT NULL DEFAULT 0,
    elapsed_days INTEGER NOT NULL DEFAULT 0,
    scheduled_days INTEGER NOT NULL DEFAULT 0,
    learning_steps INTEGER NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    state INTEGER NOT NULL DEFAULT 0,
    last_review INTEGER,
    suspended INTEGER NOT NULL DEFAULT 0,
    new_rank REAL NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_cards_due ON cards(due);
  CREATE INDEX idx_cards_state ON cards(state);
  CREATE INDEX idx_cards_word ON cards(word_id);

  CREATE TABLE review_logs (
    id INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    word_id INTEGER NOT NULL,
    reviewed_at INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    suggested_rating INTEGER,
    outcome TEXT NOT NULL,
    answer TEXT NOT NULL DEFAULT '',
    hints_used INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    state_before INTEGER NOT NULL,
    card_before TEXT NOT NULL,
    stability REAL NOT NULL,
    difficulty REAL NOT NULL,
    scheduled_days INTEGER NOT NULL,
    elapsed_days INTEGER NOT NULL
  );
  CREATE INDEX idx_logs_time ON review_logs(reviewed_at);
  CREATE INDEX idx_logs_card ON review_logs(card_id);

  CREATE TABLE lists (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    source_file TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE list_words (
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (list_id, word_id)
  );
  CREATE INDEX idx_list_words_word ON list_words(word_id);

  CREATE TABLE llm_calls (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    model TEXT NOT NULL,
    words INTEGER NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cache_hit_tokens INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    ok INTEGER NOT NULL,
    error TEXT
  );
  CREATE INDEX idx_llm_calls_time ON llm_calls(started_at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  -- The English synonyms of a sense, shown after its definition: a JSON list of words, [] when
  -- there are none. Senses written before this column existed read as having none.
  ALTER TABLE senses ADD COLUMN synonyms TEXT NOT NULL DEFAULT '[]';
  `,
  `
  -- Words looked up on the 查词 page, for its history. A word that was not in the library keeps
  -- the entry generated for it (an EntryDraft as JSON), so that looking it up again or adding it
  -- to 生词本 never asks the model twice. A word found in the library has no entry here.
  CREATE TABLE lookups (
    id INTEGER PRIMARY KEY,
    headword TEXT NOT NULL,
    norm TEXT NOT NULL UNIQUE,
    entry TEXT,
    llm_model TEXT,
    prompt_version INTEGER,
    looked_up_at INTEGER NOT NULL
  );
  CREATE INDEX idx_lookups_time ON lookups(looked_up_at);

  -- Pasted words used to get a list of their own, 粘贴的文本. They share 生词本 with the
  -- looked-up words now: that list becomes 生词本, or is merged into an existing one.
  UPDATE lists SET name = '生词本'
    WHERE id = (SELECT MIN(id) FROM lists WHERE name = '粘贴的文本')
      AND NOT EXISTS (SELECT 1 FROM lists WHERE name = '生词本');
  INSERT OR IGNORE INTO list_words (list_id, word_id, position)
    SELECT target.id, lw.word_id, target.next + lw.position
    FROM list_words lw
    JOIN lists pasted ON pasted.id = lw.list_id AND pasted.name = '粘贴的文本'
    JOIN (
      SELECT l.id, (SELECT COALESCE(MAX(position) + 1, 0) FROM list_words WHERE list_id = l.id) AS next
      FROM lists l WHERE l.name = '生词本' ORDER BY l.id LIMIT 1
    ) target;
  DELETE FROM lists WHERE name = '粘贴的文本';
  `
]

export const SCHEMA_VERSION = MIGRATIONS.length

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version])
      db.pragma(`user_version = ${version + 1}`)
    })()
  }
}
