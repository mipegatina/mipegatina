const RESEND_KEY   = process.env.RESEND_API_KEY;
const TRELLO_KEY   = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;

const FIELD_EMAIL  = '6a3c3ac7debaa6d628503d93';
const FIELD_NOMBRE = '6a3c74b937d02085b4775965';

const PIPELINE = [
  { id: '67c713e9016a2f43f857412a', label: 'Preparando tu archivo',   icon: '📋' },
  { id: '67c713e898b309459983e0fa', label: 'En impresión',            icon: '🖨️' },
  { id: '69bab1d26f1a754f8bb90872', label: 'En impresión',            icon: '🖨️' },
  { id: '69b16beb28ca67d308ecac0f', label: 'Proceso de Packing',      icon: '📦' },
  { id: '69b1a37bd28b2c3d1cedf4bc', label: 'En corte',                icon: '✂️' },
  { id: '69b1a3a4f5e2d1c3b4a5e6f7', label: 'Terminaciones / armado', icon: '🔧' },
  { id: '69b1a3c5d6e7f8a9b0c1d2e3', label: 'Empaquetando',           icon: '🎁' },
  { id: '69b1705a4e9154a7c137c993', label: 'Listo para despacho',     icon: '✅' },
  { id: '69b16bf44beeb773e457fbea', label: 'Despachado al correo',    icon: '🚚' },
  { id: '69bd31974beeb773e457fbe9', label: 'Finalizado',              icon: '🎉' },
];

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body   = JSON.parse(event.body || '{}');
    const action = body.action;
    if (!action || action.type !== 'updateCard') return { statusCode: 200, headers, body: JSON.stringify({ ok: true, msg: 'ignorado' }) };

    const cardId  = action.data?.card?.id;
    const idList  = action.data?.listAfter?.id;
    if (!cardId || !idList) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, msg: 'sin datos' }) };

    const etapa = PIPELINE.find(p => p.id === idList);
    if (!etapa) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, msg: 'lista no mapeada' }) };

    // Traer datos de la tarjeta
    const cardRes  = await fetch(`https://api.trello.com/1/cards/${cardId}?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}&customFieldItems=true`);
    const card     = await cardRes.json();
    const campos   = card.customFieldItems || [];
    const emailF   = campos.find(f => f.idCustomField === FIELD_EMAIL);
    const nombreF  = campos.find(f => f.idCustomField === FIELD_NOMBRE);
    const email    = emailF?.value?.text || '';
    const nombre   = nombreF?.value?.text || 'Cliente';
    const idShort  = card.idShort;

    if (!email) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, msg: 'sin email' }) };

    // Estado del pipeline
    const etapaIdx = PIPELINE.findIndex(p => p.id === idList);
    const stepsHtml = PIPELINE.filter((p, i) => i === 0 || PIPELINE.findIndex(q => q.label === p.label) === i)
      .slice(0, 8)
      .map((p, i) => {
        const idx = PIPELINE.findIndex(q => q.id === idList);
        const pi  = PIPELINE.findIndex(q => q.id === p.id);
        const done   = pi < etapaIdx;
        const active = p.id === idList;
        const color  = done ? '#00c264' : active ? '#0d0d0d' : '#e4e6ea';
        const txtCol = done || active ? '#fff' : '#6b7280';
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0f0f0">
          <div style="width:28px;height:28px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:12px;color:${txtCol};flex-shrink:0">${done ? '✓' : p.icon}</div>
          <span style="font-size:14px;color:${active ? '#0d0d0d' : done ? '#00c264' : '#9ca3af'};font-weight:${active ? '700' : '400'}">${p.label}${active ? ' <span style="font-size:11px;background:#e8f5e9;color:#2e7d32;padding:2px 8px;border-radius:10px;margin-left:6px">En proceso</span>' : ''}</span>
        </div>`;
      }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f4f5f7;font-family:Inter,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 16px">
  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)">
    <div style="background:#0d0d0d;padding:24px 28px;display:flex;align-items:center">
      <img src="https://mipegatina.club/mi_pegatina_logo_r.png" style="height:28px;filter:invert(1)" alt="Mi Pegatina"/>
    </div>
    <div style="padding:28px">
      <p style="font-size:15px;color:#6b7280;margin:0 0 4px">Hola, <strong style="color:#0d0d0d">${nombre}</strong> 👋</p>
      <h2 style="font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:700;color:#0d0d0d;margin:0 0 20px">Tu pedido #${idShort} fue actualizado</h2>
      <div style="background:#edfaf3;border:1px solid #b8f0d4;border-radius:10px;padding:14px 16px;margin-bottom:20px">
        <p style="margin:0;font-size:15px;color:#007a3d;font-weight:600">${etapa.icon} ${etapa.label}</p>
      </div>
      <div style="margin-bottom:24px">${stepsHtml}</div>
      <a href="https://mipegatina.club/tracker-pedidos?id=${idShort}" style="display:block;background:#00c264;color:#0d0d0d;font-weight:700;font-size:15px;text-align:center;padding:14px;border-radius:10px;text-decoration:none">Seguí tu pedido 🚀</a>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #f0f0f0;text-align:center">
      <p style="font-size:12px;color:#9ca3af;margin:0">mipegatina.club · @mipegatina · ⭐ 5.0 Google</p>
    </div>
  </div>
</div></body></html>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Mi Pegatina <pedidos@mipegatina.club>',
        to: email,
        subject: `Tu pedido #${idShort} está ${etapa.label}`,
        html
      })
    });

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, etapa: etapa.label, email }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
