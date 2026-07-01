// netlify/functions/trello-pedido-nuevo.js
// Recibe evento createCard de Trello y manda mail de confirmación al cliente

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TRELLO_API_KEY = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN   = process.env.TRELLO_TOKEN;

const FIELD_EMAIL  = '6a3c3ac7debaa6d628503d93';
const FIELD_NOMBRE = '6a3c74b937d02085b4775965';

async function getCardFields(cardId) {
  const url = `https://api.trello.com/1/cards/${cardId}/customFieldItems?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

function buildEmailHtml({ nombre, numero }) {
  const trackerUrl = `https://mipegatina.club/tracker-pedidos.html`;

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Pedido confirmado — Mi Pegatina®</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Inter',Arial,sans-serif;color:#0a0a0a;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e2e5;">

  <!-- Header -->
  <tr>
    <td style="padding:28px 32px 20px;border-bottom:1px solid #e2e2e5;text-align:center;">
      <img src="https://mipegatina.club/Mi_Pegatina_Logo_R.png" alt="Mi Pegatina®" width="100" style="display:block;height:auto;margin:0 auto 20px;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#00c264;font-family:'Courier New',monospace;">PEDIDO CONFIRMADO</p>
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;letter-spacing:-0.8px;color:#0a0a0a;">¡Recibimos tu pedido! ✅</h1>
      <p style="margin:0;font-size:14px;color:#52525b;line-height:1.5;">Hola <strong>${nombre}</strong>, ya tenemos tu pedido y lo estamos procesando.</p>
    </td>
  </tr>

  <!-- Número de pedido -->
  <tr>
    <td style="padding:24px 32px;background:#f4f4f5;border-bottom:1px solid #e2e2e5;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="background:#ffffff;border:1px solid rgba(0,194,100,0.4);border-radius:12px;padding:16px 20px;box-shadow:0 2px 16px rgba(0,194,100,0.08);text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#00a855;font-family:'Courier New',monospace;">TU NÚMERO DE PEDIDO</p>
            <p style="margin:0;font-size:32px;font-weight:800;color:#0a0a0a;letter-spacing:-1px;font-family:'Courier New',monospace;">${numero}</p>
            <p style="margin:6px 0 0;font-size:12px;color:#71717a;">Guardá este número para hacer el seguimiento de tu pedido.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Próximos pasos -->
  <tr>
    <td style="padding:24px 32px;border-bottom:1px solid #e2e2e5;">
      <p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#71717a;font-family:'Courier New',monospace;">PRÓXIMOS PASOS</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="28" valign="top"><div style="width:24px;height:24px;border-radius:50%;background:rgba(0,194,100,0.1);border:1.5px solid rgba(0,194,100,0.4);font-size:11px;font-weight:700;color:#00a855;text-align:center;line-height:24px;font-family:Arial;">1</div></td>
          <td style="padding:4px 0 12px 10px;font-size:13px;color:#0a0a0a;font-family:Arial;"><strong>Seguí el estado de tu pedido</strong> — entrá al tracker con tu número y vas a ver en tiempo real en qué etapa está tu producción.</td>
        </tr>
        <tr>
          <td width="28" valign="top"><div style="width:24px;height:24px;border-radius:50%;background:rgba(0,194,100,0.1);border:1.5px solid rgba(0,194,100,0.4);font-size:11px;font-weight:700;color:#00a855;text-align:center;line-height:24px;font-family:Arial;">2</div></td>
          <td style="padding:4px 0 12px 10px;font-size:13px;color:#0a0a0a;font-family:Arial;"><strong>Esperá 3 a 5 días hábiles</strong> — estamos trabajando en tu pedido con calidad premium. Te avisamos cuando esté listo.</td>
        </tr>
        <tr>
          <td width="28" valign="top"><div style="width:24px;height:24px;border-radius:50%;background:rgba(0,194,100,0.1);border:1.5px solid rgba(0,194,100,0.4);font-size:11px;font-weight:700;color:#00a855;text-align:center;line-height:24px;font-family:Arial;">3</div></td>
          <td style="padding:4px 0 4px 10px;font-size:13px;color:#0a0a0a;font-family:Arial;"><strong>¡Disfrutá tu pedido!</strong> — cuando lo recibas, contanos tu experiencia en <a href="https://share.google/teYzfXQmAO7Fxjvz7" style="color:#00a855;">Google</a> o en Instagram <a href="https://instagram.com/mipegatina" style="color:#00a855;">@mipegatina</a>. ¡Nos hace muy felices! 🙌</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- CTA tracker -->
  <tr>
    <td style="padding:24px 32px;text-align:center;border-bottom:1px solid #e2e2e5;">
      <a href="${trackerUrl}" style="display:inline-block;background:#00c264;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;letter-spacing:0.2px;">Rastrear pedido ${numero} →</a>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:24px 32px 20px;">
      <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
        <tr>
          <td style="padding-right:10px;"><a href="https://mipegatina.club" style="font-size:12px;color:#00a855;text-decoration:none;font-family:Arial;font-weight:700;">mipegatina.club</a></td>
          <td style="font-size:12px;color:#d4d4d8;padding-right:10px;">|</td>
          <td style="font-size:12px;color:#71717a;font-family:Arial;padding-right:10px;">@mipegatina</td>
          <td style="font-size:12px;color:#d4d4d8;padding-right:10px;">|</td>
          <td style="font-size:12px;color:#71717a;font-family:Arial;">⭐ 5.0 Google</td>
        </tr>
      </table>
      <div style="height:1px;background:#e2e2e5;margin-bottom:16px;"></div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-size:11px;color:#71717a;font-family:'Courier New',monospace;">© 2026 Mi Pegatina® · Buenos Aires</td>
          <td align="right" style="font-size:11px;color:#71717a;font-family:'Courier New',monospace;">Hecho en Buenos Aires 🟣</td>
        </tr>
      </table>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

exports.handler = async (event) => {
  // Trello verifica el webhook con HEAD/GET
  if (event.httpMethod === 'HEAD' || event.httpMethod === 'GET') {
    return { statusCode: 200, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body   = JSON.parse(event.body || '{}');
    const action = body.action;

    // Solo nos interesa cuando una tarjeta entra a "Preparando tu archivo"
    const LIST_SEGUNDA = '67c713e9016a2f43f857412a';
    if (
      !action ||
      action.type !== 'updateCard' ||
      !action.data?.listAfter ||
      action.data.listAfter.id !== LIST_SEGUNDA
    ) {
      return { statusCode: 200, body: 'ignored' };
    }

    const card   = action.data.card;
    const numero = card.idShort;

    // Obtener custom fields
    const fields      = await getCardFields(card.id);
    const emailField  = fields.find(f => f.idCustomField === FIELD_EMAIL);
    const nombreField = fields.find(f => f.idCustomField === FIELD_NOMBRE);

    const email  = emailField?.value?.text?.trim();
    const nombre = nombreField?.value?.text?.trim() || 'cliente';

    if (!email) {
      console.log(`Pedido #${numero}: sin email, no se manda mail.`);
      return { statusCode: 200, body: 'no email' };
    }

    const html = buildEmailHtml({ nombre, numero });

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'Mi Pegatina® <pedidos@mipegatina.club>',
        to:      [email],
        subject: `Pedido ${numero} confirmado — Mi Pegatina®`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      console.error('Resend error:', err);
      return { statusCode: 500, body: 'resend error' };
    }

    console.log(`Mail de confirmación enviado a ${email} — pedido #${numero}`);
    return { statusCode: 200, body: 'ok' };

  } catch (err) {
    console.error('Error:', err);
    return { statusCode: 500, body: 'internal error' };
  }
};
