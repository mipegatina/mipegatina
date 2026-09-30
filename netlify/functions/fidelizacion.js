// netlify/functions/fidelizacion.js
// Mails de fidelización — Mi Pegatina
//
// Corre sola cada 15 minutos (ver netlify.toml). En cada corrida:
//  1) "Tus stickers ya son parte del contador": a cada pedido archivado (con mail) le llega un mail con
//     cuántos stickers sumó y el total del contador. Si corresponde, suma el botón para dejar reseña en Google:
//       · solo si pasaron más de 3 meses desde la última vez que se lo pedimos a ese cliente
//       · y nunca, si ya hizo clic en "Dejar mi reseña" (lo registra la función resena.js)
//     El pedido que gana un premio del contador no recibe este mail (ya le llega el del premio).
//  2) "¿Se te están terminando?": a los 75 días de archivado un pedido, si el cliente no volvió a pedir,
//     le llega el detalle de lo que pidió con un botón "Repetir pedido" (mail pre-armado a mail@).
//     Sale entre las 11 y las 12 de Buenos Aires, una sola vez por pedido. (PAUSADO: RECOMPRA_ACTIVA = false)
//
// Todo queda anotado en la tarjeta archivada "📋 Registro fidelización" (sirve de registro y anti-duplicado).

const { _internals: C } = require('./contador');
const H = require('./hitos')._internals;

const KEY   = process.env.TRELLO_API_KEY || process.env.TRELLO_KEY;
const TOKEN = process.env.TRELLO_TOKEN || process.env.TRELLO_API_TOKEN;

const FIELD_EMAIL  = '6a3c3ac7debaa6d628503d93';
const FIELD_NOMBRE = '6a3c3ada8c3e2e8081899251';
const LISTA_PRE_TICKET = '69b1a9055ee4f69d490df4bf';

const DESDE = '2026-09-30T13:30:00.000Z';   // pedidos archivados antes de esto no reciben el mail del contador
const RESENA_CADA_DIAS = 90;                // no pedir reseña más de una vez cada 3 meses
const RECOMPRA_ACTIVA = false;             // pausado por ahora: las descripciones no siempre vienen prolijas
const RECOMPRA_DIAS = 75;                   // mail de recompra a los 75 días de archivado
const RECOMPRA_VENTANA = 5;                 // (si algún día no corre, lo manda dentro de los 5 días siguientes)
const RECOMPRA_HORA = 11;                   // hora de Buenos Aires
const PASO = 100000, PRIMER_HITO = 7400000; // mismas reglas que hitos.js
const RX_PRUEBA = /prueba|test/i;
const RX_EXCLUIR = /^(#\d+\s*)?(🎟️|🎁|📋)/;
const REGISTRO = '📋 Registro fidelización';
const URL_RESENA = 'https://mipegatina.club/.netlify/functions/resena';

const fmt = (n) => Math.round(n).toLocaleString('es-AR');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const creadaEn = (id) => new Date(parseInt(id.slice(0, 8), 16) * 1000);

async function trello(path, params = {}, method = 'GET') {
  const qs = new URLSearchParams({ key: KEY, token: TOKEN, ...params });
  const res = await fetch(`https://api.trello.com/1${path}?${qs}`, { method });
  if (!res.ok) throw new Error(`Trello ${res.status} ${method} ${path}: ${await res.text()}`);
  return res.json();
}

function datosCliente(card) {
  const items = card.customFieldItems || [];
  let email = items.find((f) => f.idCustomField === FIELD_EMAIL)?.value?.text?.trim();
  let nombre = items.find((f) => f.idCustomField === FIELD_NOMBRE)?.value?.text?.trim();
  const desc = card.desc || '';
  if (!email) email = (desc.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0];
  if (!nombre) nombre = ((desc.match(/Nombre:\s*\**([^\n*]+)/i) || [])[1] || '').trim();
  if (nombre) nombre = nombre.split(/\s+/)[0];              // de una persona: solo el primer nombre
  else nombre = (card.name || '').replace(/^#\d+\s*/, '').trim(); // si no, el nombre de la tarjeta (ej.: una marca)
  return { email: email ? email.toLowerCase() : null, nombre };
}

// Detalle del pedido para el mail de recompra: solo los datos del producto, sin contacto ni notas internas
function detallePedido(desc) {
  const lineas = (desc || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_\\>`‌]/g, '')
    .split('\n')
    .map((l) => l.trim().replace(/\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean);
  const out = [];
  for (const l of lineas) {
    let m;
    if ((m = l.match(/^(referencia|material|medida|cantidad de dise[ñn]os|cantidad)\s*:\s*(.+)$/i))) {
      const k = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
      out.push([k, m[2].trim()]);
    } else if (/^\d+[.)]\s+/.test(l) && /\d/.test(l.replace(/^\d+[.)]\s+/, ''))) {
      out.push(['', l.replace(/^\d+[.)]\s+/, '')]);
    }
  }
  return out.slice(0, 10);
}

// ───────────────────────── registro (tarjeta archivada) ─────────────────────────
async function registro(todas) {
  // Butler le agrega el número de pedido adelante ("#1006 📋 Registro…"): se busca por contenido y se usa la más vieja
  let card = todas.filter((c) => (c.name || '').includes(REGISTRO)).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  if (!card) {
    card = await trello('/cards', { idList: LISTA_PRE_TICKET, name: REGISTRO, desc: 'Registro automático de los mails de fidelización (contador, reseñas y recompra). No borrar ni desarchivar.' }, 'POST');
    await trello(`/cards/${card.id}`, { closed: 'true' }, 'PUT');
  }
  const comentarios = [];
  let before;
  for (let i = 0; i < 10; i++) {
    const b = await trello(`/cards/${card.id}/actions`, { filter: 'commentCard', limit: '1000', ...(before ? { before } : {}) });
    comentarios.push(...b);
    if (b.length < 1000) break;
    before = b[b.length - 1].id;
  }
  const marcas = comentarios.map((a) => ({ t: new Date(a.date), txt: a.data?.text || '' }));
  const tiene = (clave) => marcas.some((m) => m.txt.startsWith(`[${clave}]`));
  const ultima = (clave) => marcas.filter((m) => m.txt.startsWith(`[${clave}]`)).reduce((a, m) => (!a || m.t > a ? m.t : a), null);
  const anotar = async (clave, texto) => {
    await trello(`/cards/${card.id}/actions/comments`, { text: `[${clave}] ${texto}` }, 'POST');
    marcas.push({ t: new Date(), txt: `[${clave}] ${texto}` });   // así vale también dentro de esta misma corrida
  };
  return { tiene, ultima, anotar };
}

async function archivadasDesde(since) {
  const actions = [];
  let before;
  for (let page = 0; page < 20; page++) {
    const batch = await trello(`/boards/${C.BOARD_ID}/actions`, { filter: 'updateCard:closed', since, limit: '1000', ...(before ? { before } : {}) });
    actions.push(...batch);
    if (batch.length < 1000) break;
    before = batch[batch.length - 1].id;
  }
  const m = new Map();
  for (const a of actions) {
    if (a.data?.card?.closed !== true) continue;
    const t = new Date(a.date);
    if (!m.has(a.data.card.id) || t > m.get(a.data.card.id)) m.set(a.data.card.id, t); // último archivado
  }
  return m;
}

// ───────────────────────── mails ─────────────────────────
const p = (t, s = '') => `<p style="margin:0 0 10px;font-size:14px;color:#52525b;line-height:1.55;font-family:Arial,sans-serif;${s}">${t}</p>`;
const linkVerde = (href, t) => `<a href="${href}" style="color:#00a855;font-weight:700;text-decoration:none;">${t}</a>`;

function proximoPremio(total) {
  const m = (Math.floor(total / PASO) + 1) * PASO;
  const regalo = m % 500000 === 0 ? '200 stickers especiales gratis' : 'un cupón de 20% OFF';
  return `🎁 El pedido que cruce el <strong style="color:#0a0a0a;">${fmt(m)}</strong> gana ${regalo}. ¡Faltan ${fmt(m - total)}!`;
}

function mailContador({ nombre, numero, cantidad, total, cardId, conResena }) {
  const bloque = H.label('EL CONTADOR DE MI PEGATINA') +
    `<p style="margin:0;font-size:30px;font-weight:800;letter-spacing:-1px;color:#0a0a0a;font-family:Arial,sans-serif;">${fmt(total)}</p>
     <p style="margin:2px 0 0;font-size:13px;color:#71717a;font-family:Arial,sans-serif;">stickers impresos desde 2020 · <strong style="color:#00a855;">tu pedido: +${cantidad}</strong></p>`;
  const premio = p(proximoPremio(total), 'font-size:13px;margin:0;');
  const cuerpo = conResena
    ? H.tituloSeccion('¿NOS DEJÁS UNA RESEÑA?') +
      p('Si te gustó cómo quedaron, nos ayudás muchísimo contándolo en Google. Te lleva un minuto y hace que más gente nos encuentre.') +
      p(`${linkVerde('https://mipegatina.club/contador', 'Ver el contador en vivo →')}`, 'font-size:13px;margin:14px 0 0;')
    : premio + p(`${linkVerde('https://mipegatina.club/contador', 'Ver el contador en vivo →')}`, 'font-size:13px;margin:12px 0 0;');
  return {
    subject: `Tus ${cantidad} ya son parte del contador 🎉 — Mi Pegatina®`,
    html: H.layout({
      titulo: 'Tu pedido ya es parte del contador',
      eyebrow: `PEDIDO #${numero} · CONTADOR`,
      h1: `Tus ${cantidad} se sumaron a los ${fmt(total)} 🎉`,
      intro: `Hola${nombre ? ` <strong>${nombre}</strong>` : ''}, tu pedido <strong>#${numero}</strong> ya salió del taller y pasó a ser parte de todo lo que imprimimos desde 2020. ¡Gracias por sumar!`,
      bloque,
      cuerpo,
      boton: conResena
        ? { href: `${URL_RESENA}?c=${cardId}`, texto: 'Dejar mi reseña ⭐' }
        : null,
    }),
  };
}

function mailRecompra({ nombre, numero, detalle }) {
  const filas = detalle.map(([k, v]) => k
    ? `<tr><td style="padding:5px 0;font-size:13px;color:#71717a;font-family:Arial,sans-serif;width:120px;vertical-align:top;">${k}</td><td style="padding:5px 0;font-size:13px;color:#0a0a0a;font-weight:600;font-family:Arial,sans-serif;">${v}</td></tr>`
    : `<tr><td colspan="2" style="padding:5px 0;font-size:13px;color:#0a0a0a;font-weight:600;font-family:Arial,sans-serif;">• ${v}</td></tr>`).join('');
  const texto = [
    'Hola! Quiero repetir mi pedido #' + numero + '.',
    '',
    ...detalle.map(([k, v]) => (k ? `${k}: ${v}` : `- ${v}`)),
    '',
    '¿Cambios? (cantidad, diseño, material):',
    '',
  ].join('\n');
  const mailto = `mailto:${H.INTERNO}?subject=${encodeURIComponent(`Repetir pedido #${numero}`)}&body=${encodeURIComponent(texto)}`;
  return {
    subject: '¿Se te están terminando los stickers? 👀 — Mi Pegatina®',
    html: H.layout({
      titulo: '¿Se te están terminando?',
      eyebrow: `TU ÚLTIMO PEDIDO · #${numero}`,
      h1: '¿Se te están terminando? 👀',
      intro: `Hola${nombre ? ` <strong>${nombre}</strong>` : ''}, hace unos meses hicimos tu pedido <strong>#${numero}</strong>. Si ya se te están acabando, lo repetimos igual.`,
      bloque: H.label('LO QUE PEDISTE') + (filas
        ? `<table width="100%" cellpadding="0" cellspacing="0" border="0">${filas}</table>`
        : `<p style="margin:0;font-size:15px;font-weight:700;color:#0a0a0a;">Pedido #${numero}</p>`),
      cuerpo: p('Tocá el botón y se abre un mail con el detalle ya escrito: lo enviás y te confirmamos el precio actualizado y la fecha.') +
        p(`¿Querés cambiar algo? Escribilo en el mismo mail, o armalo de nuevo en el ${linkVerde('https://mipegatina.club/#cotizador', 'cotizador')}.`, 'margin:0;'),
      boton: { href: mailto, texto: 'Repetir pedido →' },
    }),
  };
}

// ───────────────────────── 1) mail del contador ─────────────────────────
async function mailsContador({ cerradas, reg, log }) {
  const archivedAt = await archivadasDesde(C.CUTOFF);
  const cards = cerradas
    .filter((c) => archivedAt.has(c.id) && !C.YA_CONTADAS.has(c.id) && !/^(#\d+\s*)?(🎟️|📋)/.test(c.name))
    .map((c) => { const e = C.estimate(c.desc); return { ...c, t: archivedAt.get(c.id), v: e.total, ll: e.llaveros || 0 }; })
    .sort((a, b) => a.t - b.t);

  // Mismo recorrido que el contador/hitos: total acumulado al archivar cada pedido y quién ganó un hito
  let acumulado = C.BASE, pendientes = 0;
  for (const c of cards) {
    const antes = acumulado;
    acumulado += c.v;
    for (let m = Math.ceil((antes + 1) / PASO) * PASO; m <= acumulado; m += PASO) if (m >= PRIMER_HITO) pendientes++;
    c.total = acumulado;
    if (pendientes && c.v > 0 && !RX_PRUEBA.test(c.name)) { c.ganador = true; pendientes = 0; }
  }

  const desde = new Date(DESDE);
  for (const c of cards) {
    if (c.t < desde || c.ganador || RX_PRUEBA.test(c.name) || RX_EXCLUIR.test(c.name)) continue;
    if (c.v <= 0 && c.ll <= 0) continue;
    if (reg.tiene(`contador:${c.id}`)) continue;
    const { email, nombre } = datosCliente(c);
    if (!email) continue;

    const ultimaResena = reg.ultima(`resena-enviada:${email}`);
    const conResena = !reg.tiene(`resena-click:${email}`) &&
      (!ultimaResena || Date.now() - ultimaResena > RESENA_CADA_DIAS * 864e5);
    const cantidad = c.v > 0 ? `${fmt(c.v)} stickers` : `${fmt(c.ll)} llaveros`;

    await H.enviarMail({ to: email, ...mailContador({ nombre, numero: c.idShort, cantidad, total: c.total, cardId: c.id, conResena }) });
    await reg.anotar(`contador:${c.id}`, `#${c.idShort} · ${email} · +${cantidad} · total ${fmt(c.total)}${conResena ? ' · con reseña' : ''}`);
    if (conResena) await reg.anotar(`resena-enviada:${email}`, `#${c.idShort}`);
    log.push(`contador #${c.idShort} → ${email}${conResena ? ' (+reseña)' : ''}`);
    await esperar(600);
  }
}

// ───────────────────────── 2) mail de recompra ─────────────────────────
async function mailsRecompra({ cerradas, abiertas, reg, log }) {
  if (!RECOMPRA_ACTIVA) return;
  const horaBA = (new Date().getUTCHours() + 24 - 3) % 24;
  if (horaBA !== RECOMPRA_HORA) return;

  const ahora = Date.now();
  const desdeVentana = new Date(ahora - (RECOMPRA_DIAS + RECOMPRA_VENTANA) * 864e5);
  const archivedAt = await archivadasDesde(desdeVentana.toISOString());

  // Último pedido creado por cada mail (abiertos y archivados), para saber si ya volvió a pedir
  const ultimoPedido = new Map();
  for (const c of [...abiertas, ...cerradas]) {
    if (RX_EXCLUIR.test(c.name)) continue;
    const { email } = datosCliente(c);
    if (!email) continue;
    const t = creadaEn(c.id);
    if (!ultimoPedido.has(email) || t > ultimoPedido.get(email).t) ultimoPedido.set(email, { t, id: c.id });
  }

  const enviados = new Set();
  for (const c of cerradas) {
    const t = archivedAt.get(c.id);
    if (!t) continue;
    const dias = (ahora - t) / 864e5;
    if (dias < RECOMPRA_DIAS || dias > RECOMPRA_DIAS + RECOMPRA_VENTANA) continue;
    if (RX_PRUEBA.test(c.name) || RX_EXCLUIR.test(c.name)) continue;
    const e = C.estimate(c.desc);
    if (e.total <= 0 && !(e.llaveros > 0)) continue;             // sin stickers ni llaveros (ej.: solo remeras)
    if (reg.tiene(`recompra:${c.id}`)) continue;
    const { email, nombre } = datosCliente(c);
    if (!email || enviados.has(email)) continue;
    if (ultimoPedido.get(email)?.id !== c.id) continue;          // ya hizo otro pedido después

    await H.enviarMail({ to: email, ...mailRecompra({ nombre, numero: c.idShort, detalle: detallePedido(c.desc) }) });
    await reg.anotar(`recompra:${c.id}`, `#${c.idShort} · ${email}`);
    enviados.add(email);
    log.push(`recompra #${c.idShort} → ${email}`);
    await esperar(600);
  }
}

// ───────────────────────── handler ─────────────────────────
exports.handler = async () => {
  if (!KEY || !TOKEN || !process.env.RESEND_API_KEY) return { statusCode: 500, body: 'faltan variables de entorno' };
  const log = [];
  try {
    const campos = { fields: 'name,desc,idShort,shortUrl', customFieldItems: 'true' };
    const [cerradas, abiertas] = await Promise.all([
      trello(`/boards/${C.BOARD_ID}/cards/closed`, campos),
      RECOMPRA_ACTIVA ? trello(`/boards/${C.BOARD_ID}/cards`, campos) : [],
    ]);
    const reg = await registro([...cerradas, ...abiertas]);
    try { await mailsContador({ cerradas, reg, log }); } catch (e) { console.error('contador:', e); log.push(`error contador: ${e.message}`); }
    try { await mailsRecompra({ cerradas, abiertas, reg, log }); } catch (e) { console.error('recompra:', e); log.push(`error recompra: ${e.message}`); }
    return { statusCode: 200, body: log.join('\n') || 'sin novedades' };
  } catch (e) {
    console.error('fidelizacion error:', e);
    return { statusCode: 500, body: e.message };
  }
};

exports._internals = { mailContador, mailRecompra, detallePedido, datosCliente, proximoPremio };
