// Contador de stickers del taller — Mi Pegatina
// GET /.netlify/functions/contador  →  { total, hoy, semana, mes, ultimos, ... }
//
// Cómo cuenta:
//  - BASE = histórico desde 2020 al 28/09/2026 (5.364.839, incluye ajuste de +1.860.000).
//  - Desde ese momento, CADA TARJETA QUE SE ARCHIVA en el tablero suma lo que dice su
//    descripción (estimado automático: sueltos + planchas × 8; remeras y acrílicos no suman;
//    "según archivo" = 500).
//  - Hoy / semana / mes: según la fecha en que se archivó (hora de Buenos Aires).
//  - Sin base de datos: todo se recalcula desde Trello (cacheado 30 s).

const BASE = 5364839; // histórico desde 2020: 3.504.839 estimado + 1.860.000 de ajuste (29/09/2026)
const CUTOFF = '2026-09-28T20:00:00.000Z';
const BOARD_ID = '67c713e8887ddc24b92ef825';
const TZ_OFFSET_H = -3;

// Tarjetas que ya estaban contadas en la BASE pero seguían sin archivar al 28/09
const YA_CONTADAS = new Set([
  '6ab6928b991e2204237d642a','6ab685035ca85af51ddc2b3c','6ab5057690eb1cb3ef92932f','6ab558a73e5a8529575b1c3a',
  '6ab6843fa47d39b137acb6ba','6ab507db8f047efb43e14d38','6ab501ead8ef71790ecc9229','6ab6d16c6887a9a1b362de58',
  '6ab537b78b19efc7dcda49a9','6ab54904192315635958a285','6ab55963ad1014e561ca2eb5','6ab5082e0adcc3f8f92b53c8',
  '6ab2805399fb80638c547259','6ab503f5a9599032800d55dd','6ab27b30171a7da6f9aa4726','6aad57f3bc50f0b3084af0b0',
  '6aabe870d292f10c2ccdc77b','6aad407820b97bd6bd41195b','6aabeb82261522cf019c84c9','6a9ae581317cc6aaecf0dc4f',
  '6ab558e1b98585670f61b59b','6ab524e9b3fbe46a21e9bc95',
]);

const KEY = process.env.TRELLO_KEY || process.env.TRELLO_API_KEY;
const TOKEN = process.env.TRELLO_TOKEN || process.env.TRELLO_API_TOKEN;

// ───────────────────────── Estimador de cantidades ─────────────────────────
// Estima stickers de una tarjeta de Trello a partir del texto libre.
// Devuelve { stickers, planchas, acrilicos, total } con total = stickers + planchas*8
const PLANCHA_X = 8;
const SEGUN_ARCHIVO = 500;

const RX_PLANCHA = /planch|10\s*[x×]\s*15|15\s*[x×]\s*10|10(?:[.,]5)?\s*[x×]\s*7\b|7\s*[x×]\s*10|15\s*[x×]\s*21|21\s*[x×]\s*15|14\s*[x×]\s*21|\bA5\b/i;
const RX_ACRIL = /llaver|im[aá]n|imanes|imancit|dije|acr[ií]lic|posavas|portavas|premio|\bpines?\b|hoja acr/i;
const RX_STICK = /sticker|calco|vinilo|etiqueta|suelto|holo|glitter|blanco|transparente|espejo|laca|especial/i;
const RX_REMERA = /remera|buzo(s)? con estampa/i;
const RX_ARCHIVO = /seg[uú]n (el )?(archivo|zip|nombre|adjunto)|cada archivo tiene/i;

function clean(d) {
  return (d || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/---[\s\S]*?---/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_\\>`]/g, '')
    .replace(/‌/g, '')
    .split('\n')
    .map((l) => l.trim().replace(/^[-•]\s*/, ''))
    .filter((l) => l && !/\b(celular|cel|tel[eé]fono|dni|cp|c[oó]digo postal|direcci[oó]n|sucursal)\b\s*:/i.test(l) && !/^(nombre|email|e-mail|tracking|mail de contacto|contacto|celular|cel|dni|cp|direcci|pago|env[ií]o|referencia)\b/i.test(l))
    .join('\n');
}

// "1.500" → 1500 ; ignora medidas (5 cm, 10x15, 3,5 cm, 12 cm ancho)
function quantities(line) {
  const s = line
    .replace(/\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*(?:cm|mm))?/gi, ' ')   // 10x15
    .replace(/\d+(?:[.,]\d+)?\s*(?:cm|mm|%|h\b|hs\b|m\b|metros)/gi, ' ')              // 5 cm
    .replace(/(?:de|a|con)\s+\d+(?:[.,]\d+)?\s*(?:de\s+)?(?:ancho|alto|altura|largo|di[aá]metro)/gi, ' ')
    .replace(/(?:ancho|alto|altura|largo)\s*:?\s*\d+(?:[.,]\d+)?/gi, ' ')
    .replace(/#\d+/g, ' ')
    .replace(/c[oó]digo\s*\d+/gi, ' ')
    .replace(/\b(20[2-3]\d)\b/g, ' ');                                                    // años
  const out = [];
  for (const m of s.matchAll(/\d{1,3}(?:\.\d{3})+|\d+/g)) out.push(parseInt(m[0].replace(/\./g, ''), 10));
  return out;
}

function classify(text, section) {
  if (RX_REMERA.test(text)) return 'remera';
  if (RX_PLANCHA.test(text)) return 'plancha';
  if (RX_ACRIL.test(text) && !/sticker|vinilo|calco/i.test(text)) return 'acril';
  if (RX_STICK.test(text)) return 'sticker';
  return section || 'sticker';
}

function estimate(desc) {
  const t = clean(desc);
  const res = { stickers: 0, planchas: 0, acrilicos: 0 };
  const add = (kind, n) => {
    if (kind === 'plancha') res.planchas += n;
    else if (kind === 'acril') res.acrilicos += n;
    else if (kind === 'sticker') res.stickers += n;
  };

  const lines = t.split('\n');
  const field = (name) => {
    const l = lines.find((x) => new RegExp('^-?\\s*' + name + '\\s*(total)?\\s*:', 'i').test(x));
    return l ? l.replace(/^[^:]*:/, '').trim() : null;
  };
  const cant = field('cantidad');
  const mat = field('material') || '';
  const med = field('medida') || '';
  const dis = parseInt((field('cantidad de dise[ñn]os') || '').match(/\d+/)?.[0] || '0', 10);
  const nCant = lines.filter((x) => /^-?\s*cantidad\s*(total)?\s*:/i.test(x)).length;

  // Caso 1: formulario clásico con un solo "Cantidad:"
  if (cant !== null && nCant === 1) {
    const q = quantities(cant);
    const ctx = mat + ' ' + med + ' ' + cant;
    const kindOf = () => {
      if (RX_REMERA.test(t)) return 'remera';
      if (RX_PLANCHA.test(med) || RX_PLANCHA.test(cant) || RX_PLANCHA.test(mat)) return 'plancha';
      if (RX_ACRIL.test(mat) && !RX_STICK.test(mat)) return 'acril';
      return 'sticker';
    };
    if (q.length === 1 && !/c\/u|cada|\+|\/| y /i.test(cant)) { add(kindOf(), q[0]); return finish(res, t); }
    if (q.length === 1 && /c\/u|cada/i.test(cant)) { add(kindOf(), q[0] * Math.max(dis, 1)); return finish(res, t); }
    if (q.length >= 1 && /total/i.test(cant)) {       // "500 TOTAL (200 y 300)" → toma el primero
      add(kindOf(), Math.max(...q)); return finish(res, t);
    }
    if (q.length > 1) {                                // "200 y 200", "300 planchas + 800 sueltos"
      const parts = cant.split(/\+|\/|\by\b|,/i);
      if (parts.length > 1) {
        for (const p of parts) { const pq = quantities(p); if (!pq.length) continue;
          let k;
          if (RX_REMERA.test(p)) k = 'remera';
          else if (/planch/i.test(p)) k = 'plancha';
          else if (/suelt|sticker|calco/i.test(p)) k = 'sticker';
          else if (RX_ACRIL.test(p)) k = 'acril';
          else k = kindOf();
          add(k, pq[0]); }
        return finish(res, t);
      }
    }
  }

  // Caso 2: pedido detallado por líneas
  let section = RX_ACRIL.test(mat) && !RX_STICK.test(mat) ? 'acril' : null;
  let totalLine = null;
  for (const raw of lines) {
    const l = raw.replace(/^[-•\d]+[.)]\s+/, (m) => (/^\d+[.)]\s+$/.test(m) ? '' : m)).replace(/^[-•]\s*/, '');
    if (/^cantidad de dise/i.test(l) || /^medida/i.test(l)) continue;
    const q = quantities(l);
    const hasKw = RX_PLANCHA.test(l) || RX_ACRIL.test(l) || RX_STICK.test(l) || RX_REMERA.test(l);
    if (!q.length) { if (hasKw) section = classify(l, null); continue; }  // encabezado: "Llaveros:" / "Vinilo Blanco"
    if (/^total\b|total\s*:/i.test(l)) { totalLine = q[0]; continue; }
    if (/muestra/i.test(l) && q[0] <= 5) { add('sticker', q[0]); continue; }
    const n = Math.max(...q.filter((x) => x >= 1 && x <= 50000));
    if (!isFinite(n)) continue;
    const kind = hasKw ? classify(l, section) : (section || 'sticker');
    add(kind, /c\/u|cada/i.test(l) && dis ? n * dis : n);
    if (hasKw) section = (kind === 'acril' || kind === 'remera') ? kind : null;
  }
  if (!res.stickers && !res.planchas && !res.acrilicos && totalLine) res.stickers = totalLine;
  return finish(res, t);
}

function finish(res, t) {
  if (!res.stickers && !res.planchas && !res.acrilicos && RX_ARCHIVO.test(t)) res.stickers = SEGUN_ARCHIVO;
  res.total = res.stickers + res.planchas * PLANCHA_X;
  return res;
}


// ───────────────────────── Trello ─────────────────────────
async function trello(path, params = {}) {
  const qs = new URLSearchParams({ key: KEY, token: TOKEN, ...params });
  const res = await fetch(`https://api.trello.com/1${path}?${qs}`);
  if (!res.ok) throw new Error(`Trello ${res.status} en ${path}`);
  return res.json();
}

function periodStarts(now = new Date()) {
  const local = new Date(now.getTime() + TZ_OFFSET_H * 3600e3);
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
  const toUtc = (yy, mm, dd) => new Date(Date.UTC(yy, mm, dd) - TZ_OFFSET_H * 3600e3);
  const dow = (local.getUTCDay() + 6) % 7; // 0 = lunes
  return { hoy: toUtc(y, m, d), semana: toUtc(y, m, d - dow), mes: toUtc(y, m, 1) };
}

async function compute() {
  // 1) Todas las archivadas desde el corte
  const actions = [];
  let before;
  for (let page = 0; page < 20; page++) {
    const batch = await trello(`/boards/${BOARD_ID}/actions`, {
      filter: 'updateCard:closed', since: CUTOFF, limit: '1000', ...(before ? { before } : {}),
    });
    actions.push(...batch);
    if (batch.length < 1000) break;
    before = batch[batch.length - 1].id;
  }
  const archivedAt = new Map();
  for (const a of actions) {
    if (!a.data || !a.data.card || a.data.card.closed !== true) continue;
    const id = a.data.card.id, t = new Date(a.date);
    if (!archivedAt.has(id) || t < archivedAt.get(id)) archivedAt.set(id, t);
  }

  // 2) Descripciones de las tarjetas archivadas
  const closed = archivedAt.size
    ? await trello(`/boards/${BOARD_ID}/cards/closed`, { fields: 'name,desc,closed' })
    : [];

  const starts = periodStarts();
  let sumado = 0, hoy = 0, semana = 0, mes = 0, pedidosHoy = 0;
  const ultimos = [];
  for (const card of closed) {
    const t = archivedAt.get(card.id);
    if (!t || YA_CONTADAS.has(card.id)) continue;
    const v = estimate(card.desc).total;
    if (!v) continue;
    sumado += v;
    if (t >= starts.hoy) { hoy += v; pedidosHoy++; }
    if (t >= starts.semana) semana += v;
    if (t >= starts.mes) mes += v;
    ultimos.push({ nombre: card.name, stickers: v, fecha: t.toISOString() });
  }
  ultimos.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));

  return {
    total: BASE + sumado, hoy, semana, mes, pedidosHoy,
    ultimos: ultimos.slice(0, 5),
    base: BASE, actualizado: new Date().toISOString(),
  };
}

exports.handler = async () => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=30',
    'Access-Control-Allow-Origin': '*',
  };
  if (!KEY || !TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Faltan TRELLO_KEY / TRELLO_TOKEN' }) };
  }
  try {
    return { statusCode: 200, headers, body: JSON.stringify(await compute()) };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: e.message }) };
  }
};

exports._internals = { estimate, periodStarts, compute };
