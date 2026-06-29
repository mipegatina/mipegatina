const TRELLO_KEY   = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID     = 'PIP4m6QY';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const params = event.queryStringParameters || {};
  const idShort = params.id;

  if (!idShort) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'ID requerido' }) };
  }

  try {
    const url = `https://api.trello.com/1/boards/${BOARD_ID}/cards?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}&fields=idShort,name,idList,dateLastActivity&customFieldItems=true`;
    const res   = await fetch(url);
    const cards = await res.json();

    const card = cards.find(c => c.idShort === parseInt(idShort));
    if (!card) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Pedido no encontrado' }) };
    }

    // Traer listas
    const listRes = await fetch(`https://api.trello.com/1/boards/${BOARD_ID}/lists?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`);
    const lists   = await listRes.json();
    const lista   = lists.find(l => l.id === card.idList);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        id: card.idShort,
        nombre: card.name,
        lista: lista ? lista.name : '',
        idList: card.idList,
        fecha: card.dateLastActivity
      })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
