// netlify/functions/resena.js
// Botón "Dejar mi reseña" de los mails del contador.
// Anota el clic en la tarjeta "📋 Registro fidelización" (así no se la volvemos a pedir a ese cliente)
// y redirige a la página de reseñas de Google. Si algo falla, redirige igual.

const { _internals: C } = require('./contador');
const F = require('./fidelizacion')._internals;

const KEY   = process.env.TRELLO_API_KEY || process.env.TRELLO_KEY;
const TOKEN = process.env.TRELLO_TOKEN || process.env.TRELLO_API_TOKEN;
const GOOGLE = 'https://g.page/r/CWIT8yvz01EIEAI/review';
const REGISTRO = '📋 Registro fidelización';

async function trello(path, params = {}, method = 'GET') {
  const qs = new URLSearchParams({ key: KEY, token: TOKEN, ...params });
  const res = await fetch(`https://api.trello.com/1${path}?${qs}`, { method });
  if (!res.ok) throw new Error(`Trello ${res.status}`);
  return res.json();
}

exports.handler = async (event) => {
  const cardId = (event.queryStringParameters?.c || '').replace(/[^a-f0-9]/gi, '');
  if (cardId.length === 24 && KEY && TOKEN) {
    try {
      const card = await trello(`/cards/${cardId}`, { fields: 'name,desc,idShort,idBoard', customFieldItems: 'true' });
      const { email } = F.datosCliente(card);
      if (email && card.idBoard) {
        const cerradas = await trello(`/boards/${card.idBoard}/cards/closed`, { fields: 'name' });
        const reg = cerradas.find((c) => c.name === REGISTRO);
        if (reg) {
          const coms = await trello(`/cards/${reg.id}/actions`, { filter: 'commentCard', limit: '1000' });
          if (!coms.some((a) => (a.data?.text || '').startsWith(`[resena-click:${email}]`))) {
            await trello(`/cards/${reg.id}/actions/comments`, { text: `[resena-click:${email}] #${card.idShort}` }, 'POST');
          }
        }
      }
    } catch (e) { console.error('resena:', e.message); }
  }
  return { statusCode: 302, headers: { Location: GOOGLE, 'Cache-Control': 'no-store' }, body: '' };
};
