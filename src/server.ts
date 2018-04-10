import * as WebSocket from 'ws';

export {start};

const BROADCASTS_TO_SAVE = 5;

function start(port = 5555) {
  const server = new WebSocket.Server({port});

  const lastBroadcasts = [];

  server.on('connection', socket => {
    console.log('socket connected');
    socket.on('message', message => console.log('received message', message, socket));

    lastBroadcasts.forEach(broadcast => {
      if (socket.readyState === WebSocket.OPEN) socket.send(broadcast);
    });
  });

  return broadcast;

  function broadcast(message) {
    try {
      lastBroadcasts.push(message);
      if (lastBroadcasts.length > BROADCASTS_TO_SAVE) lastBroadcasts.shift();

      server.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }
    catch (error) {
      console.error('error broadcasting', message, error);
    }
  }
}