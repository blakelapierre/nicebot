import { h, render } from 'preact-cycle';

const data = {orders:{}};

connectToServer();

function connectToServer() {
  const socket = new WebSocket(`ws://${window.location.hostname}:5555`);

  socket.addEventListener('open', () => console.log('socket connected'));
  socket.addEventListener('close', () => setTimeout(connectToServer, 1000), console.log('socket closed'));
  socket.addEventListener('error', error => console.log('socket error', error));

  socket.addEventListener('message', ({data}) => {
    handleMessage(data);
  });

  function handleMessage(message) {
    if (data.server_message) return data.server_message(message);
  }
}

function INIT(mutation) {
  data.init = true;
  data.mutation = mutation;
  data.server_message = mutation(SERVER_MESSAGE, mutation(UPDATE_ORDERS, mutation));
}

function SERVER_MESSAGE(_, update_orders, message) {
  try {
    const obj = JSON.parse(message);

    update_orders(obj);
  }
  catch (error) { console.log('error parsing server message', error, message); }
}

function UPDATE_ORDERS(_, mutation, {location, algo, orders}) {
  _.orders[location] = _.orders[location] || {};
  _.orders[location][algo] = _.orders[location][algo] || {};
  _.orders[location][algo].orders = orders;
  _.orders[location][algo].totalWorkers = orders.reduce((sum, {workers}) => sum + workers, 0);
  _.orders[location][algo].totalSpeed = orders.reduce((sum, {accepted_speed}) => sum + parseFloat(accepted_speed) * 1000, 0);
  _.orders[location][algo].hashratePerWorker = _.orders[location][algo].totalSpeed / _.orders[location][algo].totalWorkers;
  console.log(_.orders[location][algo]);
}

const SideBySide = ({}, {init, mutation, orders}) => (
  <side-by-side>
    {!init ? INIT(mutation) : undefined}
    {Object.keys(orders).map(location => <location>{Object.keys(orders[location]).map(algo => <algorithm><OrdersView orders={orders[location][algo]} location={location} algo={algo} /></algorithm>)}</location>)}
  </side-by-side>
);

const OrdersView = ({orders: {orders, totalWorkers, totalSpeed, hashratePerWorker}, location, algo}) => (
  <orders>
    <div>{location === '0' ? 'EUR' : 'USA'} {(totalSpeed).toFixed(2)} MH/s | ~{totalWorkers} workers</div>
    {orders.filter(({type, alive}) => type === 0 && alive).map(order => <OrderView order={order} totalWorkers={totalWorkers} totalSpeed={totalSpeed} hashratePerWorker={hashratePerWorker} />)}
  </orders>
);

// {order.price} {order.type} {order.alive ? 'alive' : 'dead'} {parseFloat(order.limit_speed).toFixed(2)} {(order.accepted_speed).toFixed(2)} {order.workers}
const OrderView = ({order, totalWorkers, totalSpeed}) => (
  <order title={`${order.price} limit: ${parseFloat(order.limit_speed).toFixed(2)} accepted: ${(order.accepted_speed * 1000).toFixed(2)} workers: ${order.workers}`}>
    <SpeedBar limit={parseFloat(order.limit_speed)} acceptedRatio={Math.min(1.5, Math.log2(1 + order.accepted_speed * 1000 / order.limit_speed))} workers={order.workers} workerRatio={Math.min(1.5, Math.log2(1 + order.workers / totalWorkers))} limitRatio={Math.min(1.5, Math.log2(1 + order.limit_speed / totalSpeed))} />
  </order>
);

const SpeedBar = ({limit, acceptedRatio, workers, workerRatio, limitRatio}) => (
  <speed-bar className={{'no-workers': workers === 0}}>
    <full-speed></full-speed>
    {limit === 0 ? <unlimited-speed></unlimited-speed>
                 : <accepted-speed style={{'width': `${acceptedRatio * 100}%`}}></accepted-speed>}
    <workers style={{'width': `${workerRatio * 100}%`}}></workers>
    <relative-limit style={{'left': `${limitRatio * 100}%`}}></relative-limit>
  </speed-bar>
);

render(
  SideBySide, data, document.body
);