import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, phone TEXT NOT NULL, locality TEXT NOT NULL,
      model TEXT, note TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS avito_chats (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS avito_messages (
      chat_id TEXT NOT NULL, id TEXT NOT NULL, max_mid TEXT UNIQUE,
      PRIMARY KEY (chat_id, id)
    );
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY, max_mid TEXT NOT NULL UNIQUE, operator_id TEXT NOT NULL,
      chat_id TEXT NOT NULL, text TEXT NOT NULL, expires_at INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'draft'
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
      available_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS outbox_due ON outbox(state, available_at);
    UPDATE outbox SET state = 'pending' WHERE state = 'sending' AND kind LIKE 'max-%';
    UPDATE outbox SET state = 'failed' WHERE state = 'sending';
  `);
  return db;
}

export function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function enqueue(db, id, kind, payload) {
  db.prepare('INSERT OR IGNORE INTO outbox (id, kind, payload, available_at) VALUES (?, ?, ?, ?)')
    .run(id, kind, JSON.stringify(payload), Date.now());
}
