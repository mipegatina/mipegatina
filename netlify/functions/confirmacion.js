// netlify/functions/confirmacion.js
// Mail de confirmación al cliente cuando manda un formulario del sitio (pedido o consulta).
//
// El sitio la llama (fire-and-forget) DESPUÉS de que Formspree contestó OK, así el cliente
// solo recibe el mail si su mensaje de verdad nos llegó. Sale por Resend
// desde noreply@mipegatina.club (mismo estilo que los mails del tracker); es un aviso automático que no se contesta.
//
// Resguardos (la URL es pública):
//  · solo acepta pedidos que vienen de mipegatina.club (Origin / Referer)
//  · el texto del mail es fijo: del cliente solo se usan nombre (primer nombre), el detalle (recortado y
//    sin HTML ni links clickeables) y el total
//  · tope por email (2 por hora), por IP (5 por hora) y global (40 por hora) por instancia, y no repite
//    el mismo mail dos veces seguidas
//  · el mail de consulta NO repite lo que escribió el visitante (texto 100% nuestro); el de pedido solo muestra
//    el resumen si tiene forma de pedido real (productos con subtotal)
// Si algo falla no rompe nada: el cliente igual ve su pantalla de "recibido".

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = 'Mi Pegatina® <noreply@mipegatina.club>';   // sin "responder a": es un aviso automático, no se contesta
const ORIGENES = ['mipegatina.club', 'www.mipegatina.club'];

const RX_EMAIL = /^[^@\s,;<>]{1,64}@[^@\s,;<>]{1,255}\.[^@\s,;<>]{2,}$/;
const MAX_DETALLE = 2000;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ───────────────────────── anti-abuso (en memoria, por instancia) ─────────────────────────
const registro = { email: new Map(), ip: new Map(), global: [], ultimo: new Map() };
function tope(mapa, clave, max, ventanaMs, ahora) {
  const arr = (mapa.get(clave) || []).filter((t) => ahora - t < ventanaMs);
  if (arr.length >= max) { mapa.set(clave, arr); return false; }
  arr.push(ahora); mapa.set(clave, arr); return true;
}
function permitido({ email, ip, firma }, ahora = Date.now()) {
  const HORA = 3600e3;
  if (registro.ultimo.get(email) === firma && registro.ultimo.get(email + '#t') > ahora - 10 * 60e3) return false;
  registro.global = registro.global.filter((t) => ahora - t < HORA);
  if (registro.global.length >= 40) return false;
  if (!tope(registro.email, email, 2, HORA, ahora)) return false;
  if (!tope(registro.ip, ip || 'sin-ip', 5, HORA, ahora)) return false;
  registro.global.push(ahora);
  registro.ultimo.set(email, firma); registro.ultimo.set(email + '#t', ahora);
  return true;
}

function origenValido(headers) {
  const o = headers.origin || headers.Origin || headers.referer || headers.Referer || '';
  try { return ORIGENES.includes(new URL(o).hostname); } catch (_) { return false; }
}

// ───────────────────────── mail (mismo estilo que trello-webhook.js / hitos.js) ─────────────────────────
function layout({ titulo, eyebrow, h1, intro, bloque, cuerpo }) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${esc(titulo)}</title></head>
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

  ${bloque ? `<tr>
    <td style="padding:24px 32px;background:#f4f4f5;border-bottom:1px solid #e2e2e5;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="background:#ffffff;border:1px solid rgba(0,194,100,0.4);border-radius:12px;padding:16px 20px;">
            ${bloque}
          </td>
        </tr>
      </table>
    </td>
  </tr>` : ''}

  <tr>
    <td style="padding:24px 32px;border-bottom:1px solid #e2e2e5;">
      ${cuerpo}
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
const paso = (n, t) => `<tr><td valign="top" style="padding:0 10px 10px 0;font-size:14px;font-weight:800;color:#00a855;">${n}.</td><td style="padding:0 0 10px;font-size:14px;color:#3f3f46;line-height:1.5;">${t}</td></tr>`;
const AVISO_AUTO = `<p style="margin:16px 0 0;padding:12px 14px;background:#f4f4f5;border-left:4px solid #0a0a0a;border-radius:6px;font-size:13px;font-weight:800;color:#0a0a0a;line-height:1.45;">⚠️ Este es un mensaje automático. Por favor, no lo respondas.</p>`;
const detalleHtml = (txt) => `<div style="margin:0;padding:14px 16px;background:#f4f4f5;border-radius:10px;font-size:13px;color:#3f3f46;line-height:1.55;white-space:pre-wrap;word-break:break-word;font-family:Arial,sans-serif;">${esc(txt)}</div>`;

// Convierte el texto del pedido (el mismo que le llega a Mi Pegatina por Formspree) en un resumen visual:
// una fila por producto (número, nombre, detalle y subtotal) + el desglose de totales.
function parsePedido(txt) {
  const partes = String(txt || '').split(/\n-{6,}\n?/);
  const items = [];
  for (const bloque of (partes[0] || '').split(/\n\s*\n/)) {
    const lineas = bloque.split('\n').map((l) => l.trim()).filter(Boolean);
    const m = lineas[0] && lineas[0].match(/^(\d+)\.\s*(.+)$/);
    if (!m) continue;
    const it = { n: m[1], titulo: m[2], det: [], subtotal: '' };
    for (const l of lineas.slice(1)) {
      const st = l.match(/^Subtotal:\s*(.+)$/i);
      if (st) it.subtotal = st[1]; else it.det.push(l);
    }
    items.push(it);
  }
  const totales = [];
  const facturaExtra = [];
  for (const l of String(partes[1] || '').split('\n').map((x) => x.trim()).filter(Boolean)) {
    const m = l.match(/^([^:]{1,40}):\s*(.+)$/);
    if (!m) continue;
    if (/^total/i.test(m[1])) continue;                       // el total ya va destacado arriba
    if (/^(cuit|raz[oó]n social)/i.test(m[1])) facturaExtra.push(`${m[1]}: ${m[2]}`);
    else totales.push([m[1], m[2]]);
  }
  return { items, totales, facturaExtra };
}

function resumenVisual(txt) {
  const p = parsePedido(txt);
  if (!p.items.length) return detalleHtml(txt);
  const filas = p.items.map((it, i) => `
    <tr>
      <td valign="top" width="34" style="padding:14px 0 14px 0;${i ? 'border-top:1px solid #ececef;' : ''}">
        <table cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="26" height="26" style="width:26px;height:26px;background:#00c264;border-radius:13px;color:#ffffff;font-size:13px;font-weight:800;font-family:Arial,sans-serif;">${esc(it.n)}</td></tr></table>
      </td>
      <td valign="top" style="padding:14px 10px 14px 0;${i ? 'border-top:1px solid #ececef;' : ''}">
        <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#0a0a0a;line-height:1.35;">${esc(it.titulo)}</p>
        ${it.det.map((d) => `<p style="margin:0;font-size:12.5px;color:#71717a;line-height:1.5;">${esc(d)}</p>`).join('')}
      </td>
      <td valign="top" align="right" style="padding:14px 0;${i ? 'border-top:1px solid #ececef;' : ''}white-space:nowrap;font-size:14px;font-weight:800;color:#0a0a0a;">${esc(it.subtotal)}</td>
    </tr>`).join('');
  const tot = p.totales.map(([k, v]) => `
    <tr>
      <td style="padding:3px 0;font-size:13px;color:#71717a;">${esc(k)}</td>
      <td align="right" style="padding:3px 0;font-size:13px;font-weight:700;color:#3f3f46;white-space:nowrap;">${esc(v)}</td>
    </tr>`).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e2e5;border-radius:12px;">
    <tr><td style="padding:4px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">${filas}</table>
    </td></tr>
    ${tot || p.facturaExtra.length ? `<tr><td style="padding:12px 16px 14px;background:#f4f4f5;border-top:1px solid #e2e2e5;border-radius:0 0 12px 12px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">${tot}</table>
      ${p.facturaExtra.map((x) => `<p style="margin:6px 0 0;font-size:12px;color:#71717a;">${esc(x)}</p>`).join('')}
    </td></tr>` : ''}
  </table>`;
}

function armarMail({ tipo, nombre, detalle, total }) {
  const hola = nombre ? `¡Gracias, ${esc(nombre)}!` : '¡Gracias!';
  if (tipo === 'pedido') {
    return {
      subject: 'Recibimos tu pedido — Mi Pegatina®',
      html: layout({
        titulo: 'Recibimos tu pedido',
        eyebrow: 'PEDIDO RECIBIDO',
        h1: `${hola} Recibimos tu pedido`,
        intro: 'Ya lo tenemos y lo estamos revisando. Te escribimos por mail para coordinar el pago y la entrega.',
        bloque: total ? label('TOTAL DEL PEDIDO') + `<p style="margin:0;font-size:22px;font-weight:800;letter-spacing:-0.4px;color:#0a0a0a;">${esc(total)}</p>` : '',
        cuerpo: tituloSeccion('Qué sigue ahora') +
          `<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">` +
          paso(1, 'Revisamos tu pedido y te confirmamos los detalles.') +
          paso(2, 'Coordinamos pago, producción y envío.') +
          `</table>` +
          (parsePedido(detalle).items.length ? tituloSeccion('Tu pedido') + resumenVisual(detalle) : '') +
          AVISO_AUTO + `<p style="margin:12px 0 0;font-size:12px;color:#71717a;line-height:1.5;">Si no ves nuestros mails, revisá la carpeta de spam.</p>`,
      }),
    };
  }
  return {
    subject: 'Recibimos tu consulta — Mi Pegatina®',
    html: layout({
      titulo: 'Recibimos tu consulta',
      eyebrow: 'CONSULTA RECIBIDA',
      h1: `${hola} Recibimos tu consulta`,
      intro: 'Te respondemos por mail en menos de 24 h.',
      bloque: '',
      cuerpo: AVISO_AUTO.replace('margin:16px 0 0', 'margin:0') + `<p style="margin:12px 0 0;font-size:12px;color:#71717a;line-height:1.5;">Si no ves nuestra respuesta, revisá la carpeta de spam.</p>`,
    }),
  };
}

// Limpia lo que viene del navegador: nunca confiamos en nada.
function limpiar(body) {
  const tipo = body.tipo === 'pedido' ? 'pedido' : 'consulta';
  const email = String(body.email || '').trim().toLowerCase().slice(0, 320);
  let nombre = String(body.nombre || '').trim().split(/\s+/)[0] || '';
  nombre = nombre.replace(/[<>&"'`\\]/g, '').slice(0, 40);
  const detalle = String(body.detalle || '')
    .replace(/\r/g, '')
    .replace(/https?:\/\//gi, '')          // sin links clickeables en un mail que sale de nuestro dominio
    .replace(/\n{3,}/g, '\n\n')
    .trim().slice(0, MAX_DETALLE);
  const total = String(body.total || '').replace(/[^\d$.,() \wáéíóúÁÉÍÓÚñÑ-]/g, '').trim().slice(0, 60);
  return { tipo, email, nombre, detalle, total };
}

async function enviarMail({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend: ${await res.text()}`);
}

exports.handler = async (event) => {
  const headers = { 'Cache-Control': 'no-store' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '' };
  if (!origenValido(event.headers || {})) return { statusCode: 403, headers, body: '' };
  if (!RESEND_API_KEY) { console.error('confirmacion: falta RESEND_API_KEY'); return { statusCode: 500, headers, body: '' }; }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return { statusCode: 400, headers, body: '' }; }
  const d = limpiar(body);
  if (!RX_EMAIL.test(d.email)) return { statusCode: 400, headers, body: '' };

  const ip = (event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || '').split(',')[0].trim();
  if (!permitido({ email: d.email, ip, firma: d.tipo + '|' + d.detalle })) return { statusCode: 429, headers, body: '' };

  try {
    const m = armarMail(d);
    await enviarMail({ to: d.email, subject: m.subject, html: m.html });
    console.log(`confirmacion: ${d.tipo} → ${d.email}`);
    return { statusCode: 200, headers, body: '{"ok":true}' };
  } catch (e) {
    console.error('confirmacion:', e.message);
    return { statusCode: 500, headers, body: '' };
  }
};

exports._internals = { parsePedido, limpiar, armarMail, permitido, origenValido, registro };
