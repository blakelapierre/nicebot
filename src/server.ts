import * as WebSocket from 'ws';

export {start};


function start(port = 5555) {
  const server = new WebSocket.Server({port});

  let lastBroadcast;

  server.on('connection', socket => {
    socket.on('message', message => console.log('received message', message, socket));
    socket.send(lastBroadcast);
  });

  return broadcast;

  function broadcast(message) {
    try {
      lastBroadcast = message;
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