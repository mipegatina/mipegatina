// netlify/functions/fidelizacion-prueba.js
// Manda a mail@mipegatina.club una muestra del mail "Gracias por tu pedido" + reseña (no toca Trello ni escribe a clientes).
// Uso: https://mipegatina.club/.netlify/functions/fidelizacion-prueba?clave=mp-hitos-7400
const H = require('./hitos')._internals;
const F = require('./fidelizacion')._internals;

exports.handler = async (event) => {
  if ((event.queryStringParameters || {}).clave !== 'mp-hitos-7400') return { statusCode: 403, body: 'clave incorrecta' };
  const m = F.mailContador({ nombre: 'Cliente de Prueba', numero: 999, cardId: 'prueba' });
  await H.enviarMail({ to: H.INTERNO, subject: '[PRUEBA] ' + m.subject, html: m.html });
  return { statusCode: 200, body: 'Enviado 1 mail de prueba a ' + H.INTERNO };
};
