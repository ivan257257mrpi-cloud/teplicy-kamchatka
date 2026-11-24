import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.mjs';

const config = {
  maxChatId: '-321',
  maxOperators: ['41', '42'],
  maxSecret: 'max-test-secret',
  avitoSecret: 'avito-test-secret',
  avitoAccountId: '12',
  avitoGreeting: true
};

async function fixture(t, { failFirstMaxRequest = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'greenhouse-test-'));
  const database = join(directory, 'app.sqlite');
  const outbound = [];
  let nextMid = 0;
  const app = createApp({
    database, config,
    platforms: {
      async sendMax(message) {
        if (failFirstMaxRequest) {
          failFirstMaxRequest = false;
          throw Object.assign(new Error('Simulated MAX outage'), { retryable: true });
        }
        outbound.push({ channel: 'max', ...message });
        return 'bot-message-' + ++nextMid;
      },
      async answerMax(callbackId, notification) {
        outbound.push({ channel: 'callback', callbackId, notification });
      },
      async sendAvito(chatId, text) {
        outbound.push({ channel: 'avito', chatId, text });
      }
    },
    logger: { warn() {}, error: console.error }
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const post = (path, body, headers = {}) => fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return { app, outbound, post };
}

const lead = { phone: '8 (914) 111-22-33', locality: 'Елизово', model: 'arched', note: 'Нужно к сезону', consent: true };
const avito = (id, authorId = 99, chatId = 'chat-demo') => ({
  id: 'delivery-' + id,
  version: 'v3.0.0',
  timestamp: 1795485600,
  payload: {
    type: 'message',
    value: { id, user_id: 12, author_id: authorId, chat_id: chatId, item_id: 7908107048,
      created: 1795485600, type: 'text', content: { text: 'Сколько стоит монтаж?' } }
  }
});
const maxHeaders = { 'x-max-bot-api-secret': config.maxSecret };
const maxText = (mid, linkedMid, text, userId = 41) => ({
  update_type: 'message_created',
  message: {
    recipient: { chat_id: -321 },
    sender: { user_id: userId, is_bot: false },
    link: { type: 'reply', message: { mid: linkedMid } },
    body: { mid, text }
  }
});

test('persists a valid site request and queues its normalized contact for MAX', async t => {
  const { app, outbound, post } = await fixture(t);
  const response = await post('/api/leads', lead);
  assert.equal(response.status, 201);
  const { id } = await response.json();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(app.db.prepare('SELECT phone FROM leads WHERE id = ?').get(id).phone, '+79141112233');
  await app.drain();
  assert.equal(outbound.length, 1);
  assert.match(outbound[0].text, /С сайта[\s\S]*\+79141112233[\s\S]*Елизово/);
});

test('rejects an invalid phone or missing consent without saving the request', async t => {
  const { app, post } = await fixture(t);
  assert.equal((await post('/api/leads', { ...lead, phone: '12345' })).status, 422);
  assert.equal((await post('/api/leads', { ...lead, consent: false })).status, 422);
  assert.equal(app.db.prepare('SELECT count(*) AS total FROM leads').get().total, 0);
});

test('reuses a site request after a lost response without enqueuing twice', async t => {
  const { app, post, outbound } = await fixture(t);
  const headers = { 'idempotency-key': '7c82e671-cf5e-4eff-acf0-c9bc35ce523c' };
  const response = await post('/api/leads', lead, headers);
  const retry = await post('/api/leads', lead, headers);
  assert.equal(response.status, 201);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).id, (await response.json()).id);
  assert.equal((await post('/api/leads', { ...lead, locality: 'Другая' }, headers)).status, 409);
  await app.drain();
  assert.equal(outbound.length, 1);
});

test('keeps a website lead when MAX is down and delivers it after a retry', async t => {
  const { app, post, outbound } = await fixture(t, { failFirstMaxRequest: true });
  assert.equal((await post('/api/leads', lead)).status, 201);
  await app.drain();
  assert.equal(outbound.length, 0);
  assert.equal(app.db.prepare('SELECT count(*) AS total FROM leads').get().total, 1);
  const job = app.db.prepare('SELECT state, available_at FROM outbox').get();
  assert.equal(job.state, 'pending');
  assert.ok(job.available_at > Date.now());
  app.db.exec('UPDATE outbox SET available_at = 0');
  await app.drain();
  assert.equal(outbound.length, 1);
  assert.equal(app.db.prepare('SELECT state FROM outbox').get().state, 'delivered');
});

test('sends one greeting per Avito chat and mirrors each genuine incoming message once', async t => {
  const { app, outbound, post } = await fixture(t);
  assert.equal((await post('/webhooks/avito/invalid', avito('one'))).status, 404);
  for (const event of [avito('one'), avito('one'), avito('own', 12), avito('two')]) {
    assert.equal((await post('/webhooks/avito/' + config.avitoSecret, event)).status, 200);
  }
  await app.drain();
  assert.equal(outbound.filter(item => item.channel === 'avito').length, 1);
  assert.equal(outbound.filter(item => item.channel === 'max').length, 2);
});

test('sends an authorized and confirmed MAX reply to its original Avito chat once', async t => {
  const { app, outbound, post } = await fixture(t);
  await post('/webhooks/avito/' + config.avitoSecret, avito('one', 99, 'correct-chat'));
  await post('/webhooks/avito/' + config.avitoSecret, avito('another-one', 98, 'another-chat'));
  await app.drain();
  await post('/webhooks/max', maxText('wrong-person', 'bot-message-1', 'Не отправлять', 77), maxHeaders);
  assert.equal((await post('/webhooks/max', maxText('wrong-secret', 'bot-message-1', 'Не отправлять'))).status, 403);
  await post('/webhooks/max', maxText('staff-reply', 'bot-message-1', 'Подскажите размер теплицы.'), maxHeaders);
  await app.drain();
  const preview = outbound.find(item => item.channel === 'max' && item.text.includes('Подтвердите отправку'));
  assert.ok(preview);
  assert.equal(outbound.filter(item => item.channel === 'avito').length, 2);
  const button = preview.attachments[0].payload.buttons[0][0];
  const event = {
    update_type: 'message_callback',
    callback: { callback_id: 'click-1', user: { user_id: 41 }, payload: button.payload },
    message: { recipient: { chat_id: -321 } }
  };
  await post('/webhooks/max', event, maxHeaders);
  await post('/webhooks/max', event, maxHeaders);
  await app.drain();
  assert.deepEqual(outbound.filter(item => item.channel === 'avito').slice(2), [
    { channel: 'avito', chatId: 'correct-chat', text: 'Подскажите размер теплицы.' }
  ]);
});
