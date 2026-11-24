import { createApp } from './app.mjs';
import { createPlatforms } from './platforms.mjs';

const env = process.env;
const config = {
  maxToken: env.MAX_BOT_TOKEN,
  maxChatId: env.MAX_BOT_TOKEN ? env.MAX_CHAT_ID : undefined,
  maxOperators: (env.MAX_OPERATOR_IDS || '').split(',').map(value => value.trim()).filter(Boolean),
  maxSecret: env.MAX_WEBHOOK_SECRET,
  avitoAccountId: env.AVITO_CLIENT_ID && env.AVITO_CLIENT_SECRET ? env.AVITO_ACCOUNT_ID : undefined,
  avitoClientId: env.AVITO_CLIENT_ID,
  avitoClientSecret: env.AVITO_CLIENT_SECRET,
  avitoSecret: env.AVITO_WEBHOOK_SECRET,
  avitoGreeting: env.AVITO_AUTO_REPLY === 'true'
};

const app = createApp({ database: env.DATABASE_PATH || 'data/greenhouse.sqlite', config, platforms: createPlatforms(config) });
const host = env.HOST || '127.0.0.1';
const port = Number(env.PORT || 4173);
const processQueue = () => app.drain().catch(() => console.error('Unable to process delivery queue.'));
const timer = setInterval(processQueue, 1000);
timer.unref();
app.server.listen(port, host, () => {
  console.log('Local preview: http://' + host + ':' + app.server.address().port + '/');
  if (!config.maxChatId) console.log('Preview mode: requests are stored locally.');
  processQueue();
});

async function shutdown() {
  clearInterval(timer);
  await app.close();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
