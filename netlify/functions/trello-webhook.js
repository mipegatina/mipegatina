// netlify/functions/trello-webhook.js
// Recibe eventos de Trello via Butler y manda mail con Resend

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TRELLO_API_KEY = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN  = process.env.TRELLO_TOKEN;

const FIELD_EMAIL  = '6a3c3ac7debaa6d628503d93';
const FIELD_NOMBRE = '6a3c3ada8c3e2e8081899251';

const PIPELINE = [
  { id: '69b1a9055ee4f69d490df4bf', label: 'Pedido recibido',        icon: '📋' },
  { id: '67c713e9016a2f43f857412a', label: 'Preparando tu archivo',  icon: '🎨' },
  { id: '67c713e898b309459983e0fa', label: 'En impresión',           icon: '🖨️' },
  { id: '69bab1d26f1a754f8bb90872', label: 'Imprimiendo acrílicos',  icon: '🔲' },
  { id: '67c713e929a6f163c54be58f', label: 'En corte',               icon: '✂️' },
  { id: '69b4509616a149146e76a793', label: 'Terminaciones / armado', icon: '🔧' },
  { id: '69b16beb28ca67d308ecac0f', label: 'Empaquetando',           icon: '📦' },
  { id: '69bd31974beeb773e457fbe9', label: 'Listo para despacho',    icon: '✅' },
  { id: '69b1705a4e9154a7c137c993', label: 'Despachado al correo',   icon: '🚚' },
];

// Obtiene los custom fields de una card
async function getCardFields(cardId) {
  const url = `https://api.trello.com/1/cards/${cardId}/customFieldItems?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

// Genera el HTML de los steps
function buildStepsHtml(currentListId) {
  const currentIndex = PIPELINE.findIndex(s => s.id === currentListId);
  let html = '';

  PIPELINE.forEach((step, i) => {
    const isLast = i === PIPELINE.length - 1;
    let dotBg, dotBorder, dotColor, dotInner, labelColor, labelWeight, badge, lineColor;

    if (i < currentIndex) {
      dotBg = '#00c264'; dotBorder = '#00c264'; dotColor = '#ffffff'; dotInner = '✓';
      labelColor = '#0a0a0a'; labelWeight = '500'; lineColor = '#00c264';
      badge = `<span style="display:inline-block;background:rgba(0,194,100,0.1);color:#00a855;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;padding:2px 8px;border-radius:20px;margin-left:8px;font-family:Arial,sans-serif;">Completado</span>`;
    } else if (i === currentIndex) {
      dotBg = '#00c264'; dotBorder = '#00c264'; dotColor = '#ffffff'; dotInner = step.icon;
      labelColor = '#0a0a0a'; labelWeight = '700'; lineColor = '#e2e2e5';
      badge = `<span style="display:inline-block;background:rgba(0,194,100,0.12);color:#00c264;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;padding:2px 8px;border-radius:20px;margin-left:8px;border:1px solid rgba(0,194,100,0.3);font-family:Arial,sans-serif;">En proceso</span>`;
    } else {
      dotBg = '#f4f4f5'; dotBorder = '#e2e2e5'; dotColor = '#c4c4c8'; dotInner = step.icon;
      labelColor = '#71717a'; labelWeight = '400'; lineColor = '#e2e2e5'; badge = '';
    }

    html += `
      <tr>
        <td width="32" valign="top">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" width="32"><div style="width:28px;height:28px;border-radius:50%;background:${dotBg};border:1.5px solid ${dotBorder};font-size:13px;color:${dotColor};text-align:center;line-height:28px;">${dotInner}</div></td></tr>
            ${!isLast ? `<tr><td align="center"><div style="width:2px;height:14px;background:${lineColor};margin:0 auto;"></div></td></tr>` : ''}
          </table>
        </td>
        <td style="padding:4px 0 ${isLast ? '4px' : '14px'} 12px;vertical-align:top;">
          <span style="font-size:13px;font-weight:${labelWeight};color:${labelColor};font-family:Arial,sans-serif;">${step.label}</span>${badge}
        </td>
      </tr>`;
  });

  return html;
}

// Genera el HTML completo del mail
function buildEmailHtml({ nombre, numero, estado, icono, listId }) {
  const stepsHtml = buildStepsHtml(listId);
  const trackerUrl = `https://mipegatina.club/tracker-pedidos.html?pedido=${numero}`;

  // Logo Mi Pegatina en base64 (PNG transparente)
  const LOGO_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAlgAAAF6CAMAAADyNNZOAAAA/1BMVEUAAAD///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3tFlQAAAAQHRSTlMA/gQuz65Ob48AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeXSGPwAAMMZJREFUeNrs';

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Estado de tu pedido — Mi Pegatina®</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Inter',Arial,sans-serif;color:#0a0a0a;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e2e5;">

  <tr>
    <td style="padding:28px 32px 20px;border-bottom:1px solid #e2e2e5;">
      <img src="https://mipegatina.club/Mi_Pegatina_Logo_R.png" alt="Mi Pegatina®" width="100" style="display:block;height:auto;margin-bottom:20px;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#00c264;font-family:'Courier New',monospace;">TRACKING · PEDIDO #${numero}</p>
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;letter-spacing:-0.8px;color:#0a0a0a;">Tu pedido avanzó una etapa 🚀</h1>
      <p style="margin:0;font-size:14px;color:#52525b;line-height:1.5;">Hola <strong>${nombre}</strong>, tu pedido acaba de pasar a:</p>
    </td>
  </tr>

  <tr>
    <td style="padding:24px 32px;background:#f4f4f5;border-bottom:1px solid #e2e2e5;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="background:#ffffff;border:1px solid rgba(0,194,100,0.4);border-radius:12px;padding:16px 20px;box-shadow:0 2px 16px rgba(0,194,100,0.08);">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#00a855;font-family:'Courier New',monospace;">ETAPA ACTUAL</p>
            <p style="margin:0;font-size:20px;font-weight:700;color:#0a0a0a;letter-spacing:-0.3px;">${icono} ${estado}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:24px 32px;border-bottom:1px solid #e2e2e5;">
      <p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#71717a;font-family:'Courier New',monospace;">PROGRESO DEL PEDIDO</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">${stepsHtml}</table>
    </td>
  </tr>

  <tr>
    <td style="padding:24px 32px;text-align:center;border-bottom:1px solid #e2e2e5;">
      <p style="margin:0 0 16px;font-size:14px;color:#52525b;">Seguí el estado en tiempo real desde acá:</p>
      <a href="${trackerUrl}" style="display:inline-block;background:#00c264;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;letter-spacing:0.2px;">Ver estado de mi pedido →</a>
    </td>
  </tr>

  <tr>
    <td style="padding:24px 32px 20px;">
      <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
        <tr>
          <td style="padding-right:10px;"><a href="https://mipegatina.club" style="font-size:12px;color:#00a855;text-decoration:none;font-family:Arial,sans-serif;font-weight:700;">mipegatina.club</a></td>
          <td style="font-size:12px;color:#d4d4d8;padding-right:10px;">|</td>
          <td style="font-size:12px;color:#71717a;font-family:Arial,sans-serif;padding-right:10px;">@mipegatina</td>
          <td style="font-size:12px;color:#d4d4d8;padding-right:10px;">|</td>
          <td style="font-size:12px;color:#71717a;font-family:Arial,sans-serif;">⭐ 5.0 Google</td>
        </tr>
      </table>
      <div style="height:1px;background:#e2e2e5;margin-bottom:16px;"></div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td>
            <p style="margin:0 0 3px;font-size:13px;color:#0a0a0a;font-family:Arial,sans-serif;">Tu diseño, antes de imprimir.</p>
            <p style="margin:0;font-size:13px;font-weight:700;color:#00c264;font-family:Arial,sans-serif;">Mirá el preview y cotizá, en segundos.</p>
          </td>
          <td align="right" valign="middle">
            <a href="https://mipegatina.club" style="display:inline-block;background:#00c264;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:10px 20px;border-radius:10px;font-family:Arial,sans-serif;">Cotizá →</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:14px 32px 18px;border-top:1px solid #e2e2e5;">
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
    const body = JSON.parse(event.body || '{}');
    const action = body.action;

    // Solo nos interesan movimientos de tarjeta entre listas
    if (!action || action.type !== 'updateCard' || !action.data?.listAfter) {
      return { statusCode: 200, body: 'ignored' };
    }

    const card    = action.data.card;
    const listId  = action.data.listAfter.id;
    const numero  = card.idShort;

    // Verificar que la lista destino está en nuestro pipeline
    const step = PIPELINE.find(s => s.id === listId);
    if (!step) return { statusCode: 200, body: 'not in pipeline' };

    // Obtener campos personalizados de la card
    const fields  = await getCardFields(card.id);
    const emailField  = fields.find(f => f.idCustomField === FIELD_EMAIL);
    const nombreField = fields.find(f => f.idCustomField === FIELD_NOMBRE);

    const email  = emailField?.value?.text?.trim();
    const nombre = nombreField?.value?.text?.trim() || 'cliente';

    if (!email) return { statusCode: 200, body: 'no email found' };

    // Construir el HTML del mail
    const html = buildEmailHtml({
      nombre,
      numero,
      estado: step.label,
      icono:  step.icon,
      listId,
    });

    // Enviar con Resend
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'Mi Pegatina® <pedidos@mipegatina.club>',
        to:      [email],
        subject: `Tu pedido #${numero} · ${step.label} — Mi Pegatina®`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      console.error('Resend error:', err);
      return { statusCode: 500, body: 'resend error' };
    }

    console.log(`Mail enviado a ${email} para pedido #${numero} → ${step.label}`);
    return { statusCode: 200, body: 'ok' };

  } catch (err) {
    console.error('Webhook error:', err);
    return { statusCode: 500, body: 'internal error' };
  }
};
