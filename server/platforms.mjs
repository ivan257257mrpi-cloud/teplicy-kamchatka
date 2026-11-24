const MAX = 'https://platform-api2.max.ru';
const AVITO = 'https://api.avito.ru';

export function createPlatforms(config) {
  let avitoToken;
  let avitoTokenUntil = 0;

  async function request(url, options, platform) {
    let response;
    try {
      response = await fetch(url, { ...options, signal: AbortSignal.timeout(9000) });
    } catch (cause) {
      throw Object.assign(new Error(platform + ': network error', { cause }), { retryable: platform === 'MAX' });
    }
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success === false) {
      throw Object.assign(new Error(platform + ': HTTP ' + response.status), {
        status: response.status,
        retryable: response.status === 429 || (platform === 'MAX' && response.status >= 500)
      });
    }
    return body;
  }

  function maxRequest(path, data) {
    return request(MAX + path, {
      method: 'POST',
      headers: { Authorization: config.maxToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }, 'MAX');
  }

  async function getAvitoToken() {
    if (avitoToken && Date.now() < avitoTokenUntil) return avitoToken;
    const data = await request(AVITO + '/token/', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.avitoClientId,
        client_secret: config.avitoClientSecret
      })
    }, 'Avito authorization');
    if (!data?.access_token) throw new Error('Avito authorization: missing token');
    avitoToken = data.access_token;
    avitoTokenUntil = Date.now() + Math.max(0, Number(data.expires_in || 0) - 60) * 1000;
    return avitoToken;
  }

  async function postAvitoMessage(chatId, text) {
    const token = await getAvitoToken();
    const url = AVITO + '/messenger/v1/accounts/' + encodeURIComponent(config.avitoAccountId) +
      '/chats/' + encodeURIComponent(chatId) + '/messages';
    return request(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', message: { text } })
    }, 'Avito');
  }

  return {
    async sendMax(message) {
      const result = await maxRequest('/messages?chat_id=' + encodeURIComponent(config.maxChatId) +
        '&disable_link_preview=true', message);
      const id = result?.message?.body?.mid;
      if (!id) throw new Error('MAX: missing message identifier');
      return id;
    },
    answerMax(callbackId, notification) {
      return maxRequest('/answers?callback_id=' + encodeURIComponent(callbackId), { notification });
    },
    async sendAvito(chatId, text) {
      try {
        await postAvitoMessage(chatId, text);
      } catch (error) {
        if (error.status !== 401) throw error;
        avitoToken = undefined;
        await postAvitoMessage(chatId, text);
      }
    }
  };
}
