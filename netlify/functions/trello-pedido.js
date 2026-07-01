exports.handler = async function(event) {
  const API_KEY   = process.env.TRELLO_API_KEY;
  const API_TOKEN = process.env.TRELLO_TOKEN;
  const BOARD_ID  = 'PIP4m6QY';

  if (!API_KEY || !API_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Configuración incompleta' }) };
  }

  const num = parseInt((event.queryStringParameters || {}).pedido, 10);
  if (!num || isNaN(num)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Número de pedido inválido' }) };
  }

  const headers = { 'Content-Type': 'application/json' };

  try {
    // 1) Buscar en cards activas
    const activeResp = await fetch(`https://api.trello.com/1/boards/${BOARD_ID}/cards?fields=idShort,name,idList,shortUrl&key=${API_KEY}&token=${API_TOKEN}`);
    if (!activeResp.ok) throw new Error('Trello error ' + activeResp.status);
    const activeCards = await activeResp.json();
    const activeCard = activeCards.find(c => c.idShort === num);

    if (activeCard) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ found: true, archived: false, card: activeCard })
      };
    }

    // 2) No estaba activa — buscar en archivadas
    const archivedResp = await fetch(`https://api.trello.com/1/boards/${BOARD_ID}/cards/closed?fields=idShort,name,idList,shortUrl&key=${API_KEY}&token=${API_TOKEN}`);
    if (!archivedResp.ok) throw new Error('Trello error ' + archivedResp.status);
    const archivedCards = await archivedResp.json();
    const archivedCard = archivedCards.find(c => c.idShort === num);

    if (archivedCard) {
      // Existe pero archivada = entregado
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ found: true, archived: true, card: archivedCard })
      };
    }

    // 3) No existe en ningún lado
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ found: false, archived: false })
    };

  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Error de conexión con Trello' }) };
  }
};
