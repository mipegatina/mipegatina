// ─────────────────────────────────────────────────────────────
// Netlify Function: panel-pedidos.js
// 
// DOS usos:
// 1. GET ?email=xxx  → devuelve pedidos del cliente para el panel
// 2. POST (body: {cardId, listId}) → webhook de Butler cuando
//    una tarjeta se mueve a "Finished", cuenta pedidos y dispara
//    emails de hito si corresponde
// ─────────────────────────────────────────────────────────────

const TRELLO_KEY   = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const BOARD_ID     = 'PIP4m6QY';
const USD_RATE     = 1550;
const EMAIL_JEAN   = 'pedidos@mipegatina.club';

// IDs campos personalizados
const FIELD_EMAIL  = '6a3c3ac7debaa6d628503d93';
const FIELD_NOMBRE = '6a3c74b937d02085b4775965';

// Lista "Finished"
const LISTA_FINISHED = '69bd31974beeb773e457fbe9';

// Estados para el cliente
const LISTA_ESTADOS = {
  '67c713e9016a2f43f857412a': 'preparando',
  '69b16beb28ca67d308ecac0f': 'produccion',
  '69bd31974beeb773e457fbe9': 'finalizado',
};

// ── HITOS DE FIDELIZACION ────────────────────────────────────
const HITOS = {
  5:  { regalo: '50 stickers vinil blanco',       sorpresa: true },
  10: { regalo: '100 stickers holograficos',       sorpresa: true },
  15: { regalo: '150 stickers holograficos',       sorpresa: true },
  20: { regalo: '200 stickers holograficos',       sorpresa: true },
};

// ── FUZZY MATCHING MATERIALES ────────────────────────────────
const MATERIALES_MAP = {
  blancoPremium:       ['blanco','blanco premium','vinil blanco','vinil blanco premium','bco','bco premium','white','blanca','b/premium','vblanco'],
  transparentePremium: ['transparente','transp','transparent premium','vinil transparente','vinil transp','trans','vtransp'],
  holo:                ['holo','holografico','holografico','holographic','holograma','holo gold','hologr'],
  glitter:             ['glitter','gliter','purpurina','brillantina'],
  acrilico:            ['acrilico','acrilico','acril','acr','acrylic'],
  llavero:             ['llavero','keychain','key'],
  iman:                ['iman','iman','magnet','imanes'],
  dije:                ['dije','charm','colgante'],
  plancha:             ['plancha','planchas','sheet','a4']
};

const M2_PRECIOS = {
  blancoPremium:       { '5x5':26.8,'6x6':25.2,'7x7':24.0,'8x8':23.1,'9x9':22.5 },
  transparentePremium: { '5x5':29.2,'6x6':27.4,'7x7':26.1,'8x8':25.1,'9x9':24.4 }
};
const PLANCHA_USD   = { '5x5':24,'6x6':22 };
const ACRILICO_BASE = 438.9;
const LLAVERO_FIJO  = 0.143;
const IMAN_FIJO     = 0.11;

// ── HELPERS ──────────────────────────────────────────────────
function matchMaterial(texto) {
  texto = (texto || '').toLowerCase().trim();
  for (const [key, aliases] of Object.entries(MATERIALES_MAP)) {
    for (const alias of aliases) {
      if (texto.includes(alias) || alias.includes(texto)) return key;
    }
  }
  return null;
}

function normalizarMedida(med) {
  return (med || '').toLowerCase()
    .replace(/\s*[x×]\s*/g,'x').replace(/\s*cm\s*/g,'').replace(/\s+/g,'').trim();
}

function parsearDescripcion(desc) {
  if (!desc) return [];
  const lineas = {};
  const regex  = /^(material|cantidad|medida)\s*:\s*(.*)$/gim;
  let m;
  while ((m = regex.exec(desc)) !== null) {
    const key = m[1].trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z_]/g,'');
    lineas[key] = m[2].trim();
  }
  const sep      = /\s*[\/,·]\s*/;
  const mats     = (lineas['material'] || '').split(sep).map(s=>s.trim()).filter(Boolean);
  const cants    = (lineas['cantidad'] || '').split(sep).map(s=>s.trim()).filter(Boolean);
  const meds     = (lineas['medida']   || '').split(sep).map(s=>s.trim()).filter(Boolean);

  const count    = Math.max(mats.length, 1);
  const items    = [];
  for (let i = 0; i < count; i++) {
    items.push({
      material:   (mats[i]  || '').toLowerCase().trim(),
      cantidad:   parseInt((cants[i] || '0').replace(/[^0-9]/g,'')) || 0,
      medida:     normalizarMedida(meds[i] || ''),

    });
  }
  return items;
}

function calcularPrecioUSD(items) {
  let total = 0;
  for (const item of items) {
    const mat = matchMaterial(item.material);
    const qty = item.cantidad;
    const med = item.medida;
    if (!mat || !qty) continue;
    let unitUSD = 0;
    if (mat === 'plancha') {
      unitUSD = PLANCHA_USD[med] || 23;
      total  += unitUSD * qty;
    } else if (mat === 'llavero' || mat === 'acrilico') {
      const cm = parseInt(med) || 4;
      unitUSD  = ACRILICO_BASE * (cm/100)*(cm/100) + LLAVERO_FIJO;
      total   += unitUSD * qty;
    } else if (mat === 'iman') {
      const cm = parseInt(med) || 4;
      unitUSD  = ACRILICO_BASE * (cm/100)*(cm/100) + IMAN_FIJO;
      total   += unitUSD * qty;
    } else if (M2_PRECIOS[mat]) {
      const precio = M2_PRECIOS[mat][med] || M2_PRECIOS[mat]['5x5'];
      const cm     = parseInt(med) || 5;
      unitUSD      = precio * (cm/100)*(cm/100);
      if (qty >= 300) unitUSD *= 0.95;
      total += unitUSD * qty;
    }
  }
  return total;
}

function estadoCliente(card) {
  if (card.closed) return 'finalizado';
  return LISTA_ESTADOS[card.idList] || 'produccion';
}

function formatearFecha(iso) {
  if (!iso) return '';
  const d     = new Date(iso);
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return d.getDate() + ' ' + meses[d.getMonth()] + ' ' + d.getFullYear();
}

function descripcionAmigable(items) {
  return items.map(i => {
    const partes = [];
    if (i.material) partes.push(i.material.charAt(0).toUpperCase() + i.material.slice(1));
    if (i.medida)   partes.push(i.medida + ' cm');
    if (i.cantidad) partes.push(i.cantidad + ' u');
    return partes.join(' · ');
  }).filter(Boolean).join(' / ');
}

// ── TRELLO API ────────────────────────────────────────────────
async function fetchTodasLasTarjetas() {
  const url = `https://api.trello.com/1/boards/${BOARD_ID}/cards/all`
    + `?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`
    + `&customFieldItems=true&fields=id,idShort,name,desc,idList,closed,dateLastActivity`;
  const res = await fetch(url);
  return res.json();
}

async function fetchTarjeta(cardId) {
  const url = `https://api.trello.com/1/cards/${cardId}`
    + `?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}&customFieldItems=true`;
  const res = await fetch(url);
  return res.json();
}

function extraerEmailNombre(card) {
  const campos = card.customFieldItems || [];
  const emailF = campos.find(f => f.idCustomField === FIELD_EMAIL);
  const nombreF = campos.find(f => f.idCustomField === FIELD_NOMBRE);
  return {
    email:  (emailF?.value?.text  || '').trim().toLowerCase(),
    nombre: (nombreF?.value?.text || '').trim()
  };
}

// ── RESEND EMAILS ─────────────────────────────────────────────
async function enviarEmail({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Mi Pegatina <pedidos@mipegatina.club>', to, subject, html })
  });
  return res.json();
}

async function emailHitoCliente(nombre, email, numeroPedido) {
  const subject = '¡Tenemos una sorpresa para vos en tu próximo pedido! 🎁';
  const html = `
    <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff">
      <img src="https://mipegatina.club/Mi_Pegatina_Logo_R.png" alt="Mi Pegatina" style="height:36px;margin-bottom:28px"/>
      <h2 style="font-size:22px;font-weight:700;color:#0d0d0d;margin:0 0 12px">
        ¡Gracias por tu pedido #${numeroPedido}, ${nombre}! 🎉
      </h2>
      <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 20px">
        Llegaste a un hito especial con nosotros y queremos agradecerte de una manera muy concreta.
      </p>
      <div style="background:#edfaf3;border:1px solid #b8f0d4;border-radius:12px;padding:20px 24px;margin-bottom:24px">
        <p style="font-size:15px;color:#007a3d;font-weight:600;margin:0">
          🎁 En tu <strong>próxima entrega</strong> vas a encontrar una sorpresa de parte nuestra.
        </p>
      </div>
      <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 28px">
        No necesitás hacer nada, ya lo tenemos en cuenta. Es nuestra forma de decirte gracias por confiar en Mi Pegatina.
      </p>
      <a href="https://mipegatina.club/panel-cliente.html" 
         style="display:inline-block;background:#00c264;color:#000;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none">
        Ver mis pedidos →
      </a>
      <p style="font-size:12px;color:#aaa;margin-top:32px">Mi Pegatina® · Buenos Aires</p>
    </div>
  `;
  return enviarEmail({ to: email, subject, html });
}

async function emailHitoJean(nombre, email, numeroPedido, regalo) {
  const subject = `🎁 ${nombre} llegó al pedido #${numeroPedido}`;
  const html = `
    <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff">
      <img src="https://mipegatina.club/Mi_Pegatina_Logo_R.png" alt="Mi Pegatina" style="height:30px;margin-bottom:24px"/>
      <h2 style="font-size:20px;font-weight:700;color:#0d0d0d;margin:0 0 16px">
        Hito de fidelización alcanzado
      </h2>
      <div style="background:#f4f5f7;border-radius:10px;padding:18px 20px;margin-bottom:20px">
        <p style="margin:0 0 6px;font-size:14px;color:#666">Cliente</p>
        <p style="margin:0;font-size:16px;font-weight:700;color:#0d0d0d">${nombre}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#888">${email}</p>
      </div>
      <div style="background:#edfaf3;border:1px solid #b8f0d4;border-radius:10px;padding:18px 20px;margin-bottom:24px">
        <p style="margin:0 0 4px;font-size:13px;color:#007a3d;font-weight:600">REGALO A INCLUIR EN LA PRÓXIMA ENTREGA</p>
        <p style="margin:0;font-size:20px;font-weight:700;color:#0d0d0d">${regalo}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#666">Pedido número: <strong>#${numeroPedido}</strong></p>
      </div>
      <p style="font-size:13px;color:#888;margin:0">
        Ya le avisamos al cliente que tiene una sorpresa en camino. 
        Recordá incluirlo en su próxima entrega sin necesidad de que te lo pida.
      </p>
    </div>
  `;
  return enviarEmail({ to: EMAIL_JEAN, subject, html });
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // ── POST: webhook de Butler (tarjeta movida a Finished) ────
  if (event.httpMethod === 'POST') {
    try {
      const body   = JSON.parse(event.body || '{}');
      const cardId = body.cardId || body.action?.data?.card?.id;
      if (!cardId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'cardId requerido' }) };

      const card              = await fetchTarjeta(cardId);
      const { email, nombre } = extraerEmailNombre(card);
      if (!email) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, msg: 'Sin email, ignorado' }) };

      // Contar pedidos finalizados de este cliente
      const todas    = await fetchTodasLasTarjetas();
      const finalizados = todas.filter(c => {
        const campos = c.customFieldItems || [];
        const ef     = campos.find(f => f.idCustomField === FIELD_EMAIL);
        const em     = (ef?.value?.text || '').trim().toLowerCase();
        return em === email && (c.closed || c.idList === LISTA_FINISHED);
      });

      const numeroPedido = finalizados.length;
      const hito         = HITOS[numeroPedido];

      if (hito) {
        await Promise.all([
          emailHitoCliente(nombre || email.split('@')[0], email, numeroPedido),
          emailHitoJean(nombre || email.split('@')[0], email, numeroPedido, hito.regalo)
        ]);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, hito: numeroPedido, regalo: hito.regalo }) };
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, pedidos: numeroPedido, hito: false }) };

    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── GET: panel del cliente ─────────────────────────────────
  const email = ((event.queryStringParameters || {}).email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email requerido' }) };
  }

  try {
    const todas = await fetchTodasLasTarjetas();

    // Traer listas para mapear nombres
    const listasRes = await fetch(
      `https://api.trello.com/1/boards/${BOARD_ID}/lists?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}&filter=all`
    );
    const listas   = await listasRes.json();
    const listaMap = {};
    for (const l of listas) listaMap[l.id] = l.name;

    const pedidos = [];
    let nombre    = '';

    for (const card of todas) {
      const campos  = card.customFieldItems || [];
      const emailF  = campos.find(f => f.idCustomField === FIELD_EMAIL);
      const emailCard = (emailF?.value?.text || '').trim().toLowerCase();
      if (emailCard !== email) continue;

      if (!nombre) {
        const nombreF = campos.find(f => f.idCustomField === FIELD_NOMBRE);
        nombre = nombreF?.value?.text || '';
      }

      const items      = parsearDescripcion(card.desc);
      const precioUSD  = calcularPrecioUSD(items);
      const estado     = estadoCliente(card);

      // Nombre del campo personalizado de esta tarjeta especifica
      const nombreTarjeta = campos.find(f => f.idCustomField === FIELD_NOMBRE);
      const nombrePedido  = nombreTarjeta?.value?.text || nombre || card.name;

      pedidos.push({
        id:        card.idShort,
        nombre:    nombrePedido,
        estado,
        lista:     listaMap[card.idList] || '',
        fecha:     formatearFecha(card.dateLastActivity),
        archivada: card.closed
      });
    }

    pedidos.sort((a, b) => b.id - a.id);

    // Contar finalizados para el progreso de hitos
    const finalizados  = pedidos.filter(p => p.estado === 'finalizado').length;
    const totalUnidades = pedidos.reduce((s, p) =>
      s + p.items.reduce((si, it) => si + (it.cantidad || 0), 0), 0);

    // Próximo hito
    const hitosOrdenados = Object.keys(HITOS).map(Number).sort((a,b)=>a-b);
    const proximoHito    = hitosOrdenados.find(h => h > finalizados) || null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok:            true,
        nombre:        nombre || email.split('@')[0],
        email,
        pedidos,
        totalPedidos:  pedidos.length,
        finalizados,
        totalUnidades,
        proximoHito,
        faltanParaHito: proximoHito ? proximoHito - finalizados : 0
      })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
