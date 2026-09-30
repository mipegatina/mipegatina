// netlify/functions/hitos-prueba.js
// Manda a mail@mipegatina.club una muestra de los mails de premios (no toca Trello ni escribe a clientes).
// Uso: https://mipegatina.club/.netlify/functions/hitos-prueba?clave=mp-hitos-7400
const H = require('./hitos')._internals;

exports.handler = async (event) => {
  if ((event.queryStringParameters || {}).clave !== 'mp-hitos-7400') return { statusCode: 403, body: 'clave incorrecta' };
  const vence = H.vencimiento();
  const cupon = H.premioDe(7400000), orden = H.premioDe(7500000);
  const codigo = H.codigoCupon(7400000);
  const base = { nombre: 'Cliente de Prueba', numero: 999 };
  const mails = [
    H.mailCliente({ m: 7400000, ...base, p: cupon, codigo, vence }),
    H.mailCliente({ m: 7500000, ...base, p: orden, codigo: null, vence }),
    H.mailInterno({ m: 7400000, ...base, email: 'cliente@ejemplo.com', p: cupon, codigo, vence, urlGanadora: 'https://trello.com/b/PIP4m6QY/mi-pegatina', urlPremio: 'https://trello.com/b/PIP4m6QY/mi-pegatina' }),
    H.mailRecordatorioCliente({ nombre: base.nombre, p: cupon, codigo, vence }),
  ];
  for (const m of mails) await H.enviarMail({ to: H.INTERNO, subject: `[PRUEBA] ${m.subject}`, html: m.html });
  return { statusCode: 200, body: `Enviados ${mails.length} mails de prueba a ${H.INTERNO}` };
};
