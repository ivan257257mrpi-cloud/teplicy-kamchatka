import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enqueue, openStore, transaction } from './store.mjs';

const publicPath = fileURLToPath(new URL('../public/', import.meta.url));
const greeting = 'Здравствуйте! Спасибо, что написали. Мы получили ваше сообщение и ответим здесь, как только освободимся.';
const models = new Map([['arched', 'Арочная'], ['pointed', 'Каплевидная'], ['gable', 'Прямостенная']]);
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm'
};
const string = value => typeof value === 'string' ? value.trim() : '';
const identifier = value => ['number', 'string'].includes(typeof value) ? String(value) : '';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function matches(actual, expected) {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
    throw Object.assign(new Error('Expected JSON'), { status: 415 });
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes <= 65536) chunks.push(chunk);
  }
  if (bytes > 65536) throw Object.assign(new Error('Payload too large'), { status: 413 });
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

function leadFrom(body) {
  const raw = string(body?.phone);
  const digits = raw.replace(/\D/g, '');
  const locality = string(body?.locality);
  const note = string(body?.note);
  const model = string(body?.model);
  if (!/^[+\d() .-]+$/.test(raw) || !/^(?:[78])?\d{10}$/.test(digits) ||
      !locality || locality.length > 100 || note.length > 650 ||
      (model && !models.has(model)) || body?.consent !== true) return null;
  return { phone: '+7' + digits.slice(-10), locality, model, note };
}

async function serveStatic(request, response, pathname) {
  const root = resolve(publicPath);
  const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!path.startsWith(root + sep) || !mime[extname(path)]) return json(response, 404, { error: 'Not found' });
  const file = await stat(path).catch(() => null);
  if (!file?.isFile()) return json(response, 404, { error: 'Not found' });
  const headers = {
    'Content-Type': mime[extname(path)],
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; frame-src https://yandex.ru; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  };
  const wantRange = request.headers.range;
  let start = 0;
  let end = file.size - 1;
  if (wantRange) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(wantRange);
    start = range?.[1] ? Number(range[1]) : Math.max(0, file.size - Number(range?.[2]));
    end = range?.[1] && range[2] ? Math.min(file.size - 1, Number(range[2])) : end;
    if (!range || (!range[1] && !range[2]) || start > end || !Number.isSafeInteger(start)) {
      response.writeHead(416, { 'Content-Range': 'bytes */' + file.size });
      return response.end();
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
  }
  headers['Content-Length'] = Math.max(0, end - start + 1);
  headers['Accept-Ranges'] = 'bytes';
  response.writeHead(wantRange ? 206 : 200, headers);
  if (request.method === 'HEAD' || !file.size) return response.end();
  createReadStream(path, { start, end }).on('error', () => response.destroy()).pipe(response);
}

export function createApp({ database, config = {}, platforms, logger = console }) {
  const db = openStore(database);
  const canSendMax = Boolean(config.maxChatId && platforms?.sendMax);
  const canSendAvito = Boolean(config.avitoAccountId && platforms?.sendAvito);
  const operators = new Set(config.maxOperators || []);
  let activeDrain;

  function receiveLead(body, key) {
    const lead = leadFrom(body);
    if (!lead) return null;
    const id = key || randomUUID();
    return transaction(db, () => {
      if (key) {
        const previous = db.prepare('SELECT phone, locality, model, note FROM leads WHERE id = ?').get(id);
        if (previous) {
          if (previous.phone !== lead.phone || previous.locality !== lead.locality ||
              previous.model !== lead.model || previous.note !== lead.note) {
            return { status: 409, error: 'Данные изменились. Отправьте заявку ещё раз.' };
          }
          return { id, status: 200 };
        }
      }
      db.prepare('INSERT INTO leads VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, lead.phone, lead.locality, lead.model, lead.note, Date.now());
      const lines = ['С сайта · заявка ' + id.slice(0, 8), 'Телефон: ' + lead.phone, 'Населённый пункт: ' + lead.locality];
      if (lead.model) lines.push('Теплица: ' + models.get(lead.model));
      if (lead.note) lines.push('Комментарий: ' + lead.note);
      enqueue(db, 'lead:' + id, 'max-lead', { text: lines.join('\n') });
      return { id, status: 201 };
    });
  }

  function receiveAvito(body) {
    const event = body?.payload;
    const message = event?.value;
    if (event?.type !== 'message' || !message || message.type === 'system') return;
    const chatId = identifier(message.chat_id);
    const id = identifier(message.id);
    const authorId = identifier(message.author_id);
    const accountId = identifier(message.user_id);
    if (!id || !chatId || !authorId || accountId !== config.avitoAccountId ||
        accountId === authorId || message.direction === 'out') return;
    transaction(db, () => {
      const change = db.prepare('INSERT OR IGNORE INTO avito_messages (chat_id, id) VALUES (?, ?)').run(chatId, id);
      if (!change.changes) return;
      const first = db.prepare('INSERT OR IGNORE INTO avito_chats VALUES (?)').run(chatId).changes;
      if (first && config.avitoGreeting) enqueue(db, 'greeting:' + chatId, 'avito-greeting', { chatId, text: greeting });
      const content = string(message.content?.text).slice(0, 3200) || 'Вложение — откройте диалог в Авито.';
      const item = identifier(message.item_id);
      const title = ['Авито · новое сообщение', item ? 'Объявление № ' + item : '', content,
        'Чтобы ответить покупателю, используйте «Ответить» на это сообщение.'].filter(Boolean).join('\n\n');
      enqueue(db, 'avito:' + JSON.stringify([chatId, id]), 'max-avito', { chatId, id, message: { text: title } });
    });
  }

  function receiveMax(body) {
    const message = body?.message;
    if (identifier(message?.recipient?.chat_id) !== config.maxChatId) return;
    if (body.update_type === 'message_created') {
      const operator = identifier(message.sender?.user_id);
      const mid = identifier(message.body?.mid);
      const linked = message.link?.type === 'reply' ? identifier(message.link.message?.mid) : '';
      const text = string(message.body?.text);
      if (!operators.has(operator) || message.sender?.is_bot || !mid || !linked || !text || text.length > 1000) return;
      const inbound = db.prepare('SELECT chat_id FROM avito_messages WHERE max_mid = ?').get(linked);
      if (!inbound) return;
      transaction(db, () => {
        const id = randomUUID();
        const result = db.prepare('INSERT OR IGNORE INTO drafts (id, max_mid, operator_id, chat_id, text, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, mid, operator, inbound.chat_id, text, Date.now() + 15 * 60 * 1000);
        if (!result.changes) return;
        enqueue(db, 'draft:' + id, 'max-draft', {
          text: 'Подтвердите отправку покупателю Авито\n\n' + text,
          attachments: [{ type: 'inline_keyboard', payload: { buttons: [[
            { type: 'callback', text: 'Отправить', payload: 'send:' + id },
            { type: 'callback', text: 'Отменить', payload: 'cancel:' + id }
          ]] } }]
        });
      });
      return;
    }
    if (body.update_type !== 'message_callback') return;
    const callbackId = identifier(body.callback?.callback_id);
    const operator = identifier(body.callback?.user?.user_id);
    const [action, id] = string(body.callback?.payload).split(':');
    if (!callbackId || !['send', 'cancel'].includes(action) || !id || !operators.has(operator)) return;
    transaction(db, () => {
      const draft = db.prepare('SELECT * FROM drafts WHERE id = ? AND operator_id = ?').get(id, operator);
      let notification = 'Черновик недоступен или истёк.';
      if (draft?.state === 'draft' && draft.expires_at > Date.now()) {
        if (action === 'send' && !canSendAvito) {
          notification = 'Отправка в Авито пока не настроена.';
        } else {
          db.prepare('UPDATE drafts SET state = ? WHERE id = ?').run(action === 'send' ? 'queued' : 'canceled', id);
          if (action === 'send') enqueue(db, 'reply:' + id, 'avito-reply', { id, chatId: draft.chat_id, text: draft.text });
          notification = action === 'send' ? 'Ответ поставлен в очередь.' : 'Черновик отменён.';
        }
      }
      enqueue(db, 'callback:' + callbackId, 'max-callback', { callbackId, notification });
    });
  }

  function claim() {
    return transaction(db, () => {
      const job = db.prepare(`
        SELECT * FROM outbox WHERE state = 'pending' AND available_at <= ?
          AND ((kind LIKE 'max-%' AND ?) OR (kind LIKE 'avito-%' AND ?))
        ORDER BY CASE WHEN kind = 'max-callback' THEN 0 ELSE 1 END, rowid LIMIT 1
      `).get(Date.now(), Number(canSendMax), Number(canSendAvito));
      if (job) db.prepare("UPDATE outbox SET state = 'sending', attempts = attempts + 1 WHERE id = ?").run(job.id);
      return job;
    });
  }

  async function work() {
    let job;
    while ((job = claim())) {
      const payload = JSON.parse(job.payload);
      try {
        let maxMid;
        if (job.kind === 'max-callback') await platforms.answerMax(payload.callbackId, payload.notification);
        else if (job.kind.startsWith('avito-')) await platforms.sendAvito(payload.chatId, payload.text);
        else maxMid = await platforms.sendMax(job.kind === 'max-avito' ? payload.message : payload);
        transaction(db, () => {
          if (job.kind === 'max-avito') {
            db.prepare('UPDATE avito_messages SET max_mid = ? WHERE chat_id = ? AND id = ?')
              .run(maxMid, payload.chatId, payload.id);
          }
          if (job.kind === 'avito-reply') {
            db.prepare("UPDATE drafts SET state = 'sent' WHERE id = ?").run(payload.id);
            enqueue(db, 'sent:' + payload.id, 'max-result', { text: 'Ответ отправлен в Авито.' });
          }
          db.prepare("UPDATE outbox SET state = 'delivered', payload = '{}' WHERE id = ?").run(job.id);
        });
      } catch (error) {
        const retry = error.retryable && job.attempts < 7 && job.kind !== 'max-callback';
        const availableAt = Date.now() + Math.min(300_000, 5000 * 2 ** job.attempts);
        transaction(db, () => {
          db.prepare('UPDATE outbox SET state = ?, available_at = ? WHERE id = ?')
            .run(retry ? 'pending' : 'failed', availableAt, job.id);
          if (!retry && job.kind === 'avito-reply') {
            db.prepare("UPDATE drafts SET state = 'failed' WHERE id = ?").run(payload.id);
            enqueue(db, 'failed:' + payload.id, 'max-result', {
              text: 'Авито не подтвердил отправку. Проверьте диалог на Авито перед повторной отправкой.'
            });
          }
        });
        logger.warn('Delivery issue', { kind: job.kind, retry, status: error.status });
      }
    }
  }

  function drain() {
    activeDrain ||= work().finally(() => { activeDrain = undefined; });
    return activeDrain;
  }

  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (request.method === 'GET' || request.method === 'HEAD') return await serveStatic(request, response, path);
      if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed' });
      if (path === '/api/leads') {
        if (request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: 'Forbidden' });
        const key = request.headers['idempotency-key'];
        if (key && !uuid.test(key)) return json(response, 400, { error: 'Не удалось подтвердить номер отправки.' });
        const result = receiveLead(await readJson(request), key?.toLowerCase());
        if (!result) return json(response, 422, { error: 'Проверьте телефон, населённый пункт и согласие.' });
        if (result.error) return json(response, result.status, { error: result.error });
        return json(response, result.status, { id: result.id, mode: canSendMax ? 'live' : 'preview' });
      }
      if (path === '/webhooks/max') {
        if (!matches(request.headers['x-max-bot-api-secret'], config.maxSecret)) return json(response, 403, { error: 'Forbidden' });
        receiveMax(await readJson(request));
        return json(response, 200, { ok: true });
      }
      if (path.startsWith('/webhooks/avito/') && matches(path.slice('/webhooks/avito/'.length), config.avitoSecret)) {
        receiveAvito(await readJson(request));
        return json(response, 200, { ok: true });
      }
      return json(response, 404, { error: 'Not found' });
    } catch (error) {
      if (!error.status && !(error instanceof URIError)) logger.error('Request error', { name: error.name });
      if (!response.headersSent) json(response, error.status || (error instanceof URIError ? 400 : 500), { error: 'Не удалось обработать запрос.' });
    }
  });
  server.requestTimeout = 15_000;

  return {
    db, server, drain,
    async close() {
      if (server.listening) await new Promise(resolveClose => server.close(resolveClose));
      await activeDrain;
      db.close();
    }
  };
}
