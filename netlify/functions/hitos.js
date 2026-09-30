// netlify/functions/hitos.js
// Premios por hitos del contador de stickers — Mi Pegatina
//
// Corre sola cada 15 minutos (ver netlify.toml). En cada corrida:
//  1) Recorre las tarjetas archivadas desde el corte, en orden, sumando stickers igual que el contador.
//  2) Si una tarjeta cruzó un hito (cada 100.000), la premia:
//       - múltiplo de 500.000 → orden de compra sin cargo: 200 stickers especiales de 5 cm
//       - resto               → cupón 20% OFF en la próxima compra
//     · mail al cliente + mail interno a mail@mipegatina.club
//     · crea la tarjeta del premio en "Pre Ticket" con vencimiento a 15 días
//     · deja un comentario en la tarjeta ganadora (registro y anti-duplicado)
//  3) Recordatorios: 3 días antes del vencimiento (cliente + interno) y aviso interno al vencer.

const { _internals: C } = require('./contador');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const KEY   = process.env.TRELLO_API_KEY || process.env.TRELLO_KEY;
const TOKEN = process.env.TRELLO_TOKEN || process.env.TRELLO_API_TOKEN;

const FIELD_EMAIL  = '6a3c3ac7debaa6d628503d93';
const FIELD_NOMBRE = '6a3c3ada8c3e2e8081899251';
const LISTA_PRE_TICKET = '69b1a9055ee4f69d490df4bf';

const INTERNO = 'mail@mipegatina.club';
const FROM = 'Mi Pegatina® <pedidos@mipegatina.club>';
const PASO = 100000;          // hito cada 100.000
const PASO_GRANDE = 500000;   // premio grande cada 500.000
const PRIMER_HITO = 7400000;  // los hitos anteriores no se premian
const DIAS_VIGENCIA = 15;
const DIAS_AVISO = 3;
const RX_PRUEBA = /prueba|test/i;

const MARCA_GANADOR = (m) => `🎉 Ganador del hito ${fmt(m)}`;
const MARCA_RECORDATORIO = '⏰ Recordatorio de vencimiento enviado';
const MARCA_VENCIDO = '⌛ Premio vencido — aviso enviado';

// ───────────────────────── utilidades ─────────────────────────
const fmt = (n) => Math.round(n).toLocaleString('es-AR');
const fecha = (d) => new Date(d).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' });

async function trello(path, params = {}, method = 'GET') {
  const qs = new URLSearchParams({ key: KEY, token: TOKEN, ...params });
  const res = await fetch(`https://api.trello.com/1${path}?${qs}`, { method });
  if (!res.ok) throw new Error(`Trello ${res.status} ${method} ${path}: ${await res.text()}`);
  return res.json();
}

async function enviarMail({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [].concat(to), subject, html }),
  });
  if (!res.ok) throw new Error(`Resend: ${await res.text()}`);
}

function codigoCupon(m) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  for (let i = 0; i < 4; i++) r += abc[Math.floor(Math.random() * abc.length)];
  return `MP${Math.round(m / 100000)}-${r}`;
}

function vencimiento() {
  // 15 días desde hoy, a las 18:00 de Buenos Aires (21:00 UTC)
  const d = new Date(Date.now() + DIAS_VIGENCIA * 864e5);
  d.setUTCHours(21, 0, 0, 0);
  return d;
}

async function datosCliente(card) {
  const items = card.customFieldItems || [];
  let email = items.find((f) => f.idCustomField === FIELD_EMAIL)?.value?.text?.trim();
  let nombre = items.find((f) => f.idCustomField === FIELD_NOMBRE)?.value?.text?.trim();
  const desc = card.desc || '';
  if (!email) email = (desc.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0];
  if (!nombre) nombre = ((desc.match(/Nombre:\s*\**([^\n*]+)/i) || [])[1] || '').trim();
  if (!nombre) nombre = (card.name || '').replace(/^#\d+\s*/, '').trim();
  return { email: email || null, nombre: nombre || 'cliente' };
}

function premioDe(m) {
  return m % PASO_GRANDE === 0
    ? { tipo: 'orden', titulo: '200 stickers especiales de 5 cm', subtitulo: 'Orden de compra sin cargo', emoji: '🎁' }
    : { tipo: 'cupon', titulo: '20% OFF en tu próxima compra', subtitulo: 'Cupón de descuento', emoji: '🎟️' };
}

// ───────────────────────── mails (mismo estilo que trello-webhook.js) ─────────────────────────
function layout({ titulo, eyebrow, h1, intro, bloque, cuerpo, boton }) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${titulo}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Inter',Arial,sans-serif;color:#0a0a0a;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e2e5;">

  <tr>
    <td style="padding:28px 32px 20px;border-bottom:1px solid #e2e2e5;">
      <img src="https://mipegatina.club/Mi_Pegatina_Logo_R.png" alt="Mi Pegatina®" width="100" style="display:block;height:auto;margin-bottom:20px;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#00c264;font-family:'Courier New',monospace;">${eyebrow}</p>
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;letter-spacing:-0.8px;color:#0a0a0a;">${h1}</h1>
      <p style="margin:0;font-size:14px;color:#52525b;line-height:1.5;">${intro}</p>
    </td>
  </tr>

  <tr>
    <td style="padding:24px 32px;background:#f4f4f5;border-bottom:1px solid #e2e2e5;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="background:#ffffff;border:1px solid rgba(0,194,100,0.4);border-radius:12px;padding:16px 20px;box-shadow:0 2px 16px rgba(0,194,100,0.08);">
            ${bloque}
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:24px 32px;border-bottom:1px solid #e2e2e5;">
      ${cuerpo}
    </td>
  </tr>

  ${boton ? `<tr>
    <td style="padding:24px 32px;text-align:center;border-bottom:1px solid #e2e2e5;">
      <a href="${boton.href}" style="display:inline-block;background:#00c264;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;letter-spacing:0.2px;">${boton.texto}</a>
    </td>
  </tr>` : ''}

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

const label = (t) => `<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#00a855;font-family:'Courier New',monospace;">${t}</p>`;
const tituloSeccion = (t) => `<p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#71717a;font-family:'Courier New',monospace;">${t}</p>`;

function bloquePremio(p, codigo) {
  return label('TU PREMIO') +
    `<p style="margin:0;font-size:20px;font-weight:700;color:#0a0a0a;letter-spacing:-0.3px;">${p.emoji} ${p.titulo}</p>` +
    (codigo ? `<p style="margin:12px 0 0;font-size:12px;color:#71717a;font-family:Arial,sans-serif;">Tu código</p>
      <p style="margin:2px 0 0;font-size:24px;font-weight:800;letter-spacing:3px;color:#00a855;font-family:'Courier New',monospace;">${codigo}</p>` : '');
}

function condiciones(p, vence) {
  const items = [
    p.tipo === 'cupon' ? '20% de descuento sobre tu próxima compra.' : 'Orden de compra sin cargo por 200 stickers en vinilo especial de 5 cm.',
    `Válido hasta el <strong>${fecha(vence)}</strong> (15 días).`,
    'Personal y no acumulable con otras promociones.',
    p.tipo === 'cupon' ? 'Para usarlo, mencioná tu código al hacer el pedido.' : 'Respondé este mail o escribinos para coordinar tu diseño.',
  ];
  return tituloSeccion('CONDICIONES') +
    items.map((t) => `<p style="margin:0 0 8px;font-size:13px;color:#52525b;line-height:1.5;font-family:Arial,sans-serif;">• ${t}</p>`).join('');
}

function mailCliente({ m, nombre, numero, p, codigo, vence }) {
  return {
    subject: `¡Tu pedido #${numero} fue el sticker ${fmt(m)}! ${p.emoji} — Mi Pegatina®`,
    html: layout({
      titulo: `Sticker ${fmt(m)} — Mi Pegatina®`,
      eyebrow: `HITO · STICKER ${fmt(m)}`,
      h1: `¡Tu pedido fue el sticker ${fmt(m)}! 🎉`,
      intro: `Hola <strong>${nombre}</strong>, desde 2020 llevamos más de ${fmt(m)} stickers impresos y tu pedido <strong>#${numero}</strong> fue el que cruzó ese número. Para festejarlo, te regalamos:`,
      bloque: bloquePremio(p, codigo),
      cuerpo: condiciones(p, vence),
      boton: p.tipo === 'cupon'
        ? { href: 'https://mipegatina.club/#cotizador', texto: 'Usar mi cupón →' }
        : { href: `mailto:${INTERNO}?subject=${encodeURIComponent(`Premio sticker ${fmt(m)} — pedido #${numero}`)}`, texto: 'Coordinar mi regalo →' },
    }),
  };
}

function filaDato(k, v) {
  return `<tr><td style="padding:6px 0;font-size:13px;color:#71717a;font-family:Arial,sans-serif;width:130px;vertical-align:top;">${k}</td><td style="padding:6px 0;font-size:13px;color:#0a0a0a;font-weight:600;font-family:Arial,sans-serif;">${v}</td></tr>`;
}

function mailInterno({ m, nombre, email, numero, p, codigo, vence, urlGanadora, urlPremio }) {
  return {
    subject: `🎉 Hito ${fmt(m)} — ganó el pedido #${numero} (${nombre})`,
    html: layout({
      titulo: `Hito ${fmt(m)}`,
      eyebrow: 'AVISO INTERNO · HITO',
      h1: `Cruzamos los ${fmt(m)} stickers 🎉`,
      intro: `El pedido <strong>#${numero}</strong> fue el que cruzó el hito. ${email ? 'Ya le llegó el mail con su premio.' : '<strong>La tarjeta no tiene mail: hay que avisarle a mano.</strong>'}`,
      bloque: label('PREMIO A ENTREGAR') + `<p style="margin:0;font-size:20px;font-weight:700;color:#0a0a0a;letter-spacing:-0.3px;">${p.emoji} ${p.titulo}</p>`,
      cuerpo: tituloSeccion('DATOS') + `<table width="100%" cellpadding="0" cellspacing="0" border="0">
        ${filaDato('Cliente', nombre)}
        ${filaDato('Mail', email || '— sin mail —')}
        ${filaDato('Pedido ganador', `<a href="${urlGanadora}" style="color:#00a855;">#${numero}</a>`)}
        ${codigo ? filaDato('Código', `<span style="font-family:'Courier New',monospace;letter-spacing:2px;">${codigo}</span>`) : ''}
        ${filaDato('Vence', fecha(vence))}
      </table>
      <p style="margin:14px 0 0;font-size:13px;color:#52525b;font-family:Arial,sans-serif;">Ya está creada la tarjeta del premio en <strong>Pre Ticket</strong> con la fecha de vencimiento.</p>`,
      boton: { href: urlPremio, texto: 'Ver tarjeta del premio →' },
    }),
  };
}

function mailRecordatorioCliente({ nombre, p, codigo, vence }) {
  return {
    subject: `⏰ Te quedan ${DIAS_AVISO} días para usar tu premio — Mi Pegatina®`,
    html: layout({
      titulo: 'Tu premio vence pronto',
      eyebrow: 'RECORDATORIO · PREMIO',
      h1: `Tu premio vence el ${fecha(vence)} ⏰`,
      intro: `Hola <strong>${nombre}</strong>, todavía no usaste tu premio. Te quedan ${DIAS_AVISO} días:`,
      bloque: bloquePremio(p, codigo),
      cuerpo: condiciones(p, vence),
      boton: p.tipo === 'cupon'
        ? { href: 'https://mipegatina.club/#cotizador', texto: 'Usar mi cupón →' }
        : { href: `mailto:${INTERNO}?subject=${encodeURIComponent('Coordinar mi premio')}`, texto: 'Coordinar mi regalo →' },
    }),
  };
}

function mailAvisoInterno({ tipo, nombre, email, p, codigo, vence, urlPremio }) {
  const vencido = tipo === 'vencido';
  return {
    subject: vencido ? `⌛ Venció sin usar: ${p.subtitulo} de ${nombre}` : `⏰ En ${DIAS_AVISO} días vence el premio de ${nombre}`,
    html: layout({
      titulo: vencido ? 'Premio vencido' : 'Premio por vencer',
      eyebrow: vencido ? 'AVISO INTERNO · VENCIDO' : 'AVISO INTERNO · RECORDATORIO',
      h1: vencido ? 'Un premio venció sin usar ⌛' : `Un premio vence el ${fecha(vence)} ⏰`,
      intro: vencido
        ? 'Venció el plazo de 15 días. Pueden archivar la tarjeta del premio.'
        : `Al cliente ya le mandamos el recordatorio${email ? '' : ' (no tiene mail cargado: avisarle a mano)'}.`,
      bloque: label('PREMIO') + `<p style="margin:0;font-size:20px;font-weight:700;color:#0a0a0a;letter-spacing:-0.3px;">${p.emoji} ${p.titulo}</p>`,
      cuerpo: tituloSeccion('DATOS') + `<table width="100%" cellpadding="0" cellspacing="0" border="0">
        ${filaDato('Cliente', nombre)}
        ${filaDato('Mail', email || '— sin mail —')}
        ${codigo ? filaDato('Código', `<span style="font-family:'Courier New',monospace;letter-spacing:2px;">${codigo}</span>`) : ''}
        ${filaDato('Vence', fecha(vence))}
      </table>`,
      boton: { href: urlPremio, texto: 'Ver tarjeta del premio →' },
    }),
  };
}

// ───────────────────────── 1) detectar ganadores ─────────────────────────
async function detectarGanadores() {
  const { BASE, CUTOFF, BOARD_ID, YA_CONTADAS, estimate } = C;

  const actions = [];
  let before;
  for (let page = 0; page < 20; page++) {
    const batch = await trello(`/boards/${BOARD_ID}/actions`, { filter: 'updateCard:closed', since: CUTOFF, limit: '1000', ...(before ? { before } : {}) });
    actions.push(...batch);
    if (batch.length < 1000) break;
    before = batch[batch.length - 1].id;
  }
  const archivedAt = new Map();
  for (const a of actions) {
    if (a.data?.card?.closed !== true) continue;
    const t = new Date(a.date);
    if (!archivedAt.has(a.data.card.id) || t < archivedAt.get(a.data.card.id)) archivedAt.set(a.data.card.id, t);
  }
  if (!archivedAt.size) return [];

  const closed = await trello(`/boards/${BOARD_ID}/cards/closed`, { fields: 'name,desc,idShort,shortUrl', customFieldItems: 'true' });
  const cards = closed
    .filter((c) => archivedAt.has(c.id) && !YA_CONTADAS.has(c.id) && !/^🎟️/.test(c.name))
    .map((c) => ({ ...c, t: archivedAt.get(c.id), v: estimate(c.desc).total }))
    .filter((c) => c.v > 0)
    .sort((a, b) => a.t - b.t);

  // Recorre en orden: cada hito cruzado se asigna a la primera tarjeta válida (no prueba) que lo cruza o la siguiente
  let acumulado = BASE;
  const pendientes = [];
  const ganadores = [];
  for (const c of cards) {
    const antes = acumulado;
    acumulado += c.v;
    for (let m = Math.ceil((antes + 1) / PASO) * PASO; m <= acumulado; m += PASO) {
      if (m >= PRIMER_HITO) pendientes.push(m);
    }
    if (pendientes.length && !RX_PRUEBA.test(c.name)) {
      for (const m of pendientes.splice(0)) ganadores.push({ m, card: c });
    }
  }
  return ganadores;
}

async function yaPremiado(cardId, m) {
  const comentarios = await trello(`/cards/${cardId}/actions`, { filter: 'commentCard', limit: '100' });
  return comentarios.some((a) => (a.data?.text || '').includes(MARCA_GANADOR(m)));
}

async function premiar({ m, card }) {
  if (await yaPremiado(card.id, m)) return false;

  const p = premioDe(m);
  const { email, nombre } = await datosCliente(card);
  const numero = card.idShort;
  const codigo = p.tipo === 'cupon' ? codigoCupon(m) : null;
  const vence = vencimiento();

  const nombreTarjeta = p.tipo === 'cupon'
    ? `🎟️ CUPÓN 20% · ${nombre} · ${codigo}`
    : `🎁 PREMIO ${fmt(m)} · ${nombre}`;
  const descTarjeta = [
    `Premio por el hito del sticker ${fmt(m)} (pedido ganador #${numero}: ${card.shortUrl}).`,
    '',
    p.tipo === 'orden' ? 'Referencia: Premio hito' : `Código: ${codigo}`,
    p.tipo === 'orden' ? 'Material: Especial' : 'Descuento: 20% en la próxima compra',
    p.tipo === 'orden' ? 'Cantidad: 200' : '',
    p.tipo === 'orden' ? 'Medida: 5 cm' : '',
    p.tipo === 'orden' ? 'SIN CARGO' : '',
    '',
    `Cliente: ${nombre}`,
    `Email cliente: ${email || 'sin mail'}`,
    `Vence: ${fecha(vence)} · No acumulable`,
    '',
    p.tipo === 'cupon' ? 'Archivar esta tarjeta cuando se aplique el cupón.' : 'Producir como un pedido normal y archivar al entregar.',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

  const nueva = await trello('/cards', { idList: LISTA_PRE_TICKET, name: nombreTarjeta, desc: descTarjeta, due: vence.toISOString(), pos: 'top' }, 'POST');

  if (email) {
    const mc = mailCliente({ m, nombre, numero, p, codigo, vence });
    await enviarMail({ to: email, ...mc });
  }
  const mi = mailInterno({ m, nombre, email, numero, p, codigo, vence, urlGanadora: card.shortUrl, urlPremio: nueva.shortUrl });
  await enviarMail({ to: INTERNO, ...mi });

  await trello(`/cards/${card.id}/actions/comments`, { text: `${MARCA_GANADOR(m)} — ${p.subtitulo}${codigo ? ` ${codigo}` : ''}, vence ${fecha(vence)}. Tarjeta del premio: ${nueva.shortUrl}` }, 'POST');
  console.log(`Hito ${m}: premiado #${numero} (${email || 'sin mail'})`);
  return true;
}

// ───────────────────────── 2) recordatorios y vencimientos ─────────────────────────
async function revisarVencimientos() {
  const abiertas = await trello(`/lists/${LISTA_PRE_TICKET}/cards`, { fields: 'name,desc,due,shortUrl' });
  const premios = abiertas.filter((c) => /^(🎁 PREMIO|🎟️ CUPÓN)/.test(c.name) && c.due);
  const ahora = Date.now();

  for (const c of premios) {
    const vence = new Date(c.due);
    const faltan = vence - ahora;
    if (faltan > DIAS_AVISO * 864e5) continue;

    const comentarios = await trello(`/cards/${c.id}/actions`, { filter: 'commentCard', limit: '100' });
    const tiene = (marca) => comentarios.some((a) => (a.data?.text || '').includes(marca));

    const p = c.name.startsWith('🎁') ? premioDe(PASO_GRANDE) : premioDe(PASO);
    const codigo = (c.desc.match(/Código:\s*(\S+)/) || [])[1] || null;
    const email = (c.desc.match(/Email cliente:\s*([\w.+-]+@[\w-]+\.[\w.-]+)/) || [])[1] || null;
    const nombre = ((c.desc.match(/Cliente:\s*(.+)/) || [])[1] || 'cliente').trim();

    if (faltan <= 0) {
      if (tiene(MARCA_VENCIDO)) continue;
      await enviarMail({ to: INTERNO, ...mailAvisoInterno({ tipo: 'vencido', nombre, email, p, codigo, vence, urlPremio: c.shortUrl }) });
      await trello(`/cards/${c.id}/actions/comments`, { text: MARCA_VENCIDO }, 'POST');
    } else {
      if (tiene(MARCA_RECORDATORIO)) continue;
      if (email) await enviarMail({ to: email, ...mailRecordatorioCliente({ nombre, p, codigo, vence }) });
      await enviarMail({ to: INTERNO, ...mailAvisoInterno({ tipo: 'recordatorio', nombre, email, p, codigo, vence, urlPremio: c.shortUrl }) });
      await trello(`/cards/${c.id}/actions/comments`, { text: MARCA_RECORDATORIO }, 'POST');
    }
  }
}

// ───────────────────────── handler ─────────────────────────
exports.handler = async () => {
  if (!KEY || !TOKEN || !RESEND_API_KEY) return { statusCode: 500, body: 'faltan variables de entorno' };
  const log = [];
  try {
    for (const g of await detectarGanadores()) {
      try { if (await premiar(g)) log.push(`premiado ${g.m} → #${g.card.idShort}`); }
      catch (e) { console.error(`Error premiando ${g.m}:`, e); log.push(`error ${g.m}: ${e.message}`); }
    }
    await revisarVencimientos();
    return { statusCode: 200, body: log.join('\n') || 'sin novedades' };
  } catch (e) {
    console.error('hitos error:', e);
    return { statusCode: 500, body: e.message };
  }
};

exports._internals = { mailCliente, mailInterno, mailRecordatorioCliente, mailAvisoInterno, premioDe, codigoCupon, vencimiento, detectarGanadores, enviarMail, INTERNO, fmt, layout, label, tituloSeccion };
