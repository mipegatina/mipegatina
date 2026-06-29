const RESEND_KEY   = process.env.RESEND_API_KEY;
const TRELLO_KEY   = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;

const FIELD_EMAIL  = '6a3c3ac7debaa6d628503d93';
const FIELD_NOMBRE = '6a3c74b937d02085b4775965';

// Hitos de fidelizacion
const HITOS = {
  5:  { regalo: '50 stickers vinil blanco' },
  10: { regalo: '100 stickers holograficos' },
  15: { regalo: '150 stickers holograficos' },
  20: { regalo: '200 stickers holograficos' },
};

const BOARD_ID       = 'PIP4m6QY';
const LISTA_FINISHED = '69bd31974beeb773e457fbe9';
const EMAIL_JEAN     = 'pedidos@mipegatina.club';

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body   = JSON.parse(event.body || '{}');
    const cardId = body.cardId || body.action?.data?.card?.id;
    if (!cardId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'cardId requerido' }) };

    // Traer datos de la tarjeta
    const cardRes = await fetch(`https://api.trello.com/1/cards/${cardId}?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}&customFieldItems=true`);
    const card    = await cardRes.json();
    const campos  = card.customFieldItems || [];
    const emailF  = campos.find(f => f.idCustomField === FIELD_EMAIL);
    const nombreF = campos.find(f => f.idCustomField === FIELD_NOMBRE);
    const email   = (emailF?.value?.text || '').trim().toLowerCase();
    const nombre  = nombreF?.value?.text || 'Cliente';

    if (!email) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, msg: 'sin email' }) };

    // Contar pedidos finalizados de este cliente
    const todasRes    = await fetch(`https://api.trello.com/1/boards/${BOARD_ID}/cards/all?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}&customFieldItems=true&fields=id,idList,closed`);
    const todas       = await todasRes.json();
    const finalizados = todas.filter(c => {
      const campos = c.customFieldItems || [];
      const ef     = campos.find(f => f.idCustomField === FIELD_EMAIL);
      const em     = (ef?.value?.text || '').trim().toLowerCase();
      return em === email && (c.closed || c.idList === LISTA_FINISHED);
    });

    const numeroPedido = finalizados.length;
    const hito         = HITOS[numeroPedido];

    if (!hito) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, pedidos: numeroPedido, hito: false }) };

    // Email al cliente
    const htmlCliente = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f4f5f7;font-family:Inter,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 16px">
  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)">
    <div style="background:#0d0d0d;padding:24px 28px">
      <img src="https://mipegatina.club/mi_pegatina_logo_r.png" style="height:28px;filter:invert(1)" alt="Mi Pegatina"/>
    </div>
    <div style="padding:28px">
      <h2 style="font-size:22px;font-weight:700;color:#0d0d0d;margin:0 0 12px">¡Gracias por tu pedido #${numeroPedido}, ${nombre}! 🎉</h2>
      <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 20px">Llegaste a un hito especial con nosotros y queremos agradecerte de una manera muy concreta.</p>
      <div style="background:#edfaf3;border:1px solid #b8f0d4;border-radius:12px;padding:20px 24px;margin-bottom:24px">
        <p style="font-size:15px;color:#007a3d;font-weight:600;margin:0">🎁 En tu <strong>próxima entrega</strong> vas a encontrar una sorpresa de parte nuestra.</p>
      </div>
      <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 28px">No necesitás hacer nada, ya lo tenemos en cuenta. Es nuestra forma de decirte gracias por confiar en Mi Pegatina.</p>
      <a href="https://mipegatina.club/panel-cliente.html" style="display:block;background:#00c264;color:#0d0d0d;font-weight:700;font-size:15px;text-align:center;padding:14px;border-radius:10px;text-decoration:none">Ver mis pedidos 🚀</a>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #f0f0f0;text-align:center">
      <p style="font-size:12px;color:#9ca3af;margin:0">mipegatina.club · @mipegatina · ⭐ 5.0 Google</p>
    </div>
  </div>
</div></body></html>`;

    // Email a Jean
    const htmlJean = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f4f5f7;font-family:Inter,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 16px">
  <div style="background:#fff;border-radius:16px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.06)">
    <h2 style="font-size:20px;font-weight:700;color:#0d0d0d;margin:0 0 16px">Hito de fidelización alcanzado</h2>
    <div style="background:#f4f5f7;border-radius:10px;padding:16px;margin-bottom:16px">
      <p style="margin:0 0 4px;font-size:13px;color:#6b7280">Cliente</p>
      <p style="margin:0;font-size:16px;font-weight:700;color:#0d0d0d">${nombre}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#9ca3af">${email}</p>
    </div>
    <div style="background:#edfaf3;border:1px solid #b8f0d4;border-radius:10px;padding:16px">
      <p style="margin:0 0 4px;font-size:12px;color:#007a3d;font-weight:600;text-transform:uppercase;letter-spacing:.5px">REGALO A INCLUIR EN LA PRÓXIMA ENTREGA</p>
      <p style="margin:0;font-size:20px;font-weight:700;color:#0d0d0d">${hito.regalo}</p>
      <p style="margin:6px 0 0;font-size:13px;color:#6b7280">Pedido número: <strong>#${numeroPedido}</strong></p>
    </div>
    <p style="font-size:13px;color:#9ca3af;margin:16px 0 0">Ya le avisamos al cliente que tiene una sorpresa en camino.</p>
  </div>
</div></body></html>`;

    await Promise.all([
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Mi Pegatina <pedidos@mipegatina.club>', to: email, subject: `¡Tenemos una sorpresa para vos en tu próximo pedido! 🎁`, html: htmlCliente })
      }),
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Mi Pegatina <pedidos@mipegatina.club>', to: EMAIL_JEAN, subject: `🎁 ${nombre} llegó al pedido #${numeroPedido}`, html: htmlJean })
      })
    ]);

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, hito: numeroPedido, regalo: hito.regalo }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
