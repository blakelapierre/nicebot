import { h, render } from 'preact-cycle';

window.addEventListener('error', error => {
  alert(`${error.message}`);
});

const data = {orders:{}, walletBalances: {}, coinExchanges: {}, walletSummary: {inBTC: 0, inUSD: 0}, proxyStats: {}};

Object.prototype.map = function(fn) {
  return Object.keys(this).map(key => fn(key, this[key]));
};

Object.prototype.forEach = function(fn) {
  Object.keys(this).forEach(key => fn(key, this[key]));
};

Object.prototype.reduce = function(fn, init) {
  return Object.values(this).reduce(fn, init);
};

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

function INIT(_, mutation) {
  _.init = true;

  _.mutation = mutation;

  _.server_message = mutation(SERVER_MESSAGE, {
    'orders': mutation(UPDATE_ORDERS, mutation),
    'my_orders': mutation(UPDATE_MY_ORDERS, mutation),
    'wallet-balances': mutation(UPDATE_WALLET_BALANCES, mutation),
    'exchange-prices': mutation(UPDATE_EXCHANGE_PRICES, mutation),
    'proxy-stats': mutation(UPDATE_PROXY_STATS, mutation)
  });

  _.conversions = {
    toBTC(coin, value = 0) {
      if (coin === 'BTC') return value;

      const exchanges = _.coinExchanges[coin] || [];

      if (exchanges.length > 0) {
        const exchange = exchanges[0],
              price = _.exchangePrices[exchange][coin].buy;

        return parseFloat(value) * price / 100000000;
      }

      return 'UNK';
    },
    toUSD(coin, value = 0) {
      if (coin === 'USD') return value;
    }
  }
}

function SERVER_MESSAGE(_, messageHandlers, message) {
  try {
    const [type, obj] = JSON.parse(message);

    (messageHandlers[type] || (() => console.log('unhandled message', type, obj)))(obj);
  }
  catch (error) { console.log('error parsing server message', error, message); }
}

function UPDATE_ORDERS(_, mutation, {location, algo, orders}) {
  _.orders[location] = _.orders[location] || {};
  _.orders[location][algo] = _.orders[location][algo] || {};
  _.orders[location][algo].orders = orders;

  const totalWorkers = orders.reduce((sum, {workers}) => sum + workers, 0);
  _.orders[location][algo].totalWorkers = totalWorkers;
  _.orders[location][algo].totalSpeed = orders.reduce((sum, {accepted_speed}) => sum + parseFloat(accepted_speed) * 1000, 0);
  _.orders[location][algo].hashratePerWorker = _.orders[location][algo].totalSpeed / _.orders[location][algo].totalWorkers;

  let i, requestedLimit = 0;
  for (i = 0; i < orders.length; i++) {
    const order = orders[i];

    order.limitAbove = requestedLimit;
    requestedLimit += order.limit_speed;

    if (order.limit_speed === 0) break;
  }
  for (i; i < orders.length; i++) {
    order.limitAbove = -1;
  }
}

function UPDATE_MY_ORDERS(_, mutation, {location, algo, orders}) {
  _.orders[location] = _.orders[location] || {};
  _.orders[location][algo] = _.orders[location][algo] || {};
  _.orders[location][algo].my_orders = orders.reduce((agg, {id}) => (agg[id] = true, agg), {});
  console.log(_.orders[location][algo].my_orders);
}

function UPDATE_WALLET_BALANCES(_, mutation, balances) {
  _.walletBalances = Object.assign(_.walletBalances || {}, balances);

  _.walletBalances.forEach((wallet, value) => {
    const {coin, balance} = value;
    value.inBTC = _.conversions.toBTC(coin, balance);
    value.inUSD = _.conversions.toUSD(coin, balance);
    value.wallet = wallet;
  });

  _.walletSummary = _.walletBalances.reduce((agg, {inBTC = 0, inUSD = 0}) => {
    agg.inBTC += parseFloat(inBTC) || 0;
    agg.inUSD += parseFloat(inUSD) || 0;
    return agg;
  }, {inBTC: 0, inUSD: 0});
}

function UPDATE_EXCHANGE_PRICES(_, mutation, exchangePrices) {
  _.exchangePrices = Object.assign(_.exchangePrices || {}, exchangePrices);
  _.coinExchanges = {};

  Object.keys(_.exchangePrices).forEach(key => {
    const coins = _.exchangePrices[key];

    coins.forEach(coin => (_.coinExchanges[coin] = _.coinExchanges[coin] || []).push(key));
  });

  _.walletBalances.forEach((wallet, value) => {
    const {coin, balance} = value;
    value.inBTC = _.conversions.toBTC(coin, balance);
    value.inUSD = _.conversions.toUSD(coin, balance);
  });

  _.walletSummary = _.walletBalances.reduce((agg, {inBTC = 0, inUSD = 0}) => {
    agg.inBTC += parseFloat(inBTC) || 0;
    agg.inUSD += parseFloat(inUSD) || 0;
    return agg;
  }, {inBTC: 0, inUSD: 0});
}

function UPDATE_PROXY_STATS(_, mutation, {proxy, stats}) {
  _.proxyStats[proxy] = stats;
}

function convertToBTC(coin, value) {
  if (coin === 'BTC') return value;


  return value;
}

function convertToUSD(coin, value) {
  return value;
}

const SideBySide = ({}, {orders}) => (
  <side-by-side>
    {Object.keys(orders).map(location => <location>{Object.keys(orders[location]).map(algo => <algorithm><OrdersView orders={orders[location][algo]} location={location} algo={algo} /></algorithm>)}</location>)}
  </side-by-side>
);

const OrdersView = ({orders: {orders = [], totalWorkers = 0, totalSpeed = 0, hashratePerWorker = 0, my_orders}, location, algo}) => (
  <orders>
    <div>{location === '0' ? 'EUR' : 'USA'} {(totalSpeed).toFixed(2)} MH/s | ~{totalWorkers} workers</div>
    {orders.filter(({type, alive}) => type === 0 && alive).map(order => <OrderView order={order} totalWorkers={totalWorkers} totalSpeed={totalSpeed} hashratePerWorker={hashratePerWorker} my_orders={my_orders} />)}
  </orders>
);

    // {Object.keys(proxyStats).map(proxy => <ProxyStats proxy={proxy} />)}
const ProxiesStats = ({}, {proxyStats}) => (
  <proxies-stats>
    <ProxyStats proxy="eur" />
    <ProxyStats proxy="usa" />
  </proxies-stats>
);

const ProxyStats = ({proxy}, {proxyStats}) => (
  <proxy-stats>
    <total>{(Object.values(proxyStats[proxy] || {}).reduce((sum, {rate, timestamp}) => sum + (timestamp < new Date().getTime() - 15 * 1000 ? 0 : rate), 0) / 1000).toFixed(2)} MH/s</total>
    <workers>
      {Object.keys(proxyStats[proxy] || {}).map(id => <worker-stats className={proxyStats[proxy][id].timestamp < (new Date().getTime() - 15 * 1000) ? 'old-timestamp' : ''}>{id}: {(proxyStats[proxy][id].rate / 1000).toFixed(2)} MH/s</worker-stats>)}
    </workers>
  </proxy-stats>
);

// {order.price} {order.type} {order.alive ? 'alive' : 'dead'} {parseFloat(order.limit_speed).toFixed(2)} {(order.accepted_speed).toFixed(2)} {order.workers}
const OrderView = ({order, totalWorkers = 0, totalSpeed = 0, hashratePerWorker = 0, my_orders = {}}) => (
  <order title={`${order.price} limit: ${parseFloat(order.limit_speed).toFixed(2)} accepted: ${(order.accepted_speed * 1000).toFixed(2)} workers: ${order.workers}`}
         className={{'my-order': my_orders[order.id]}}>
    <SpeedBar
      limit={parseFloat(order.limit_speed)}
      acceptedRatio={Math.min(1.25, Math.log2(1 + order.accepted_speed * 1000 / order.limit_speed))}
      workers={order.workers}
      limitAbove={order.limitAbove}
      workersAvailable={order.workersAvailable}
      workerRatio={Math.min(1.25, Math.log2(1 + order.workers / totalWorkers))}
      limitRatio={Math.min(1.25, Math.log2(1 + order.limit_speed / totalSpeed))} />
  </order>
);

const SpeedBar = ({limit, acceptedRatio, workers, limitAbove, workersAvailable, workerRatio, limitRatio}) => (
  <speed-bar className={{'no-workers': workers === 0, 'no-workers-available': workersAvailable <= 0}}>
    <full-speed></full-speed>
    {limit === 0 ? <unlimited-speed></unlimited-speed>
                 : <accepted-speed style={{'width': `${acceptedRatio * 100}%`}}></accepted-speed>}
    <workers style={{'width': `${workerRatio * 100}%`}}></workers>
    <relative-limit style={{'left': `${limitRatio * 100}%`}}></relative-limit>
  </speed-bar>
);

const WalletBalances = ({}, {walletBalances, walletSummary}) => (
  <wallet-balances>
    <table>
      <thead>
        <th>Coin</th>
        <th>Balance</th>
        <th>~BTC</th>
        <th>~USD</th>
      </thead>
      <tbody>
        {Object.values(walletBalances).sort((a, b) => a.inBTC > b.inBTC ? 1 : (a.inBTC === b.inBTC ? (a.wallet < b.wallet ? -1 : 1) : -1)).map(({balance, wallet, inBTC, inUSD}) => <WalletBalanceRow coin={wallet} balance={balance} inBTC={inBTC} inUSD={inUSD} />)}
      </tbody>
      <tfoot>
        <tr>
          <td colspan={2}></td>
          <td>{walletSummary.inBTC.toFixed(4)}</td>
          <td>${walletSummary.inUSD.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
  </wallet-balances>
);


const WalletBalanceRow = ({coin, balance = 0, inBTC = 0, inUSD = 0}) => (
  <tr>
    <td>{coin}</td>
    <td>{parseFloat(balance).toFixed(2)}</td>
    <td>{parseFloat(inBTC).toFixed(4)}</td>
    <td>${parseFloat(inUSD).toFixed(2)}</td>
  </tr>
);

const GUI = ({}, {init, mutation}) => (
  <gui>
    {!init ? mutation(INIT)(mutation) : undefined}
    <ProxiesStats />
    <SideBySide />
    <WalletBalances />
  </gui>
);

render(
  GUI, data, document.body
);