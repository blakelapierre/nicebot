const config = {
        threshold: 300000000,
        roiThreshold: 0.75,
        roiEndThreshold: 1,
        limit: 0,
        minimumMineTime: 60 * 1000,
        roiSchedules: [
          {roiThreshold: 1.5, roiEndThreshold: 1, minimumMineTime: 60 * 1000, limit: 0},
          {roiThreshold: 0.75, roiEndThreshold: 0.65, minimumMineTime: 30 * 1000, limit: 1}
        ]
      };

const ordersDB = {
  '0': {
    22: {}
  },
  '1': {
    22: {}
  }
};

let trtlSatoshiPrice = 3;

const algo = 22;


function pickSchedule(schedules, roi) {
  for (let i = 0; i < schedules.length; i++) {
    var schedule = schedules[i];

    if (roi > schedule.roiThreshold) return schedule;
  }
}

import * as nicehash from 'nicehash';

import {fetchUrl} from 'fetch';

const nh = new nicehash({apiId: '1233015', apiKey: '724df7cb-91fa-3fb9-266c-0552481c7f4f'});

function nhRequest(request, args) {
  return nh[request](...args).catch(error => {
    console.error('nhRequest error', request, args, error);
  });
}

runAndSchedule(() => updateOrdersStats(0, algo), 10 * 1000);
runAndSchedule(() => updateOrdersStats(1, algo), 10 * 1000);

function updateOrdersStats(location, algo) {
  nhRequest('getMyOrders', [location, algo])
    .then(response => {
      const {orders} = response.body.result;

      orders.forEach(order => {
        ordersDB[location][algo][order.id] = Object.assign(ordersDB[order.id] || {}, order, {location});
      });

      orders.forEach(printOrder);
    });
}

function printOrder({id, algo, btc_avail, limit_speed, price, end, workers, btc_paid, location, accepted_speed}) {
  const avail = parseFloat(btc_avail),
        paid = parseFloat(btc_paid);

  console.log(`${id} ${renderLocation(location)} [${renderProgress(1 - (avail / (avail + paid)))}] [${(parseFloat(accepted_speed) * 1000).toFixed(2)} MH/s] [${workers} w] [B ${price}] [${limit_speed} limit] [${avail} avail]`);
}

function renderProgress(progress) {
  const stars = Math.floor(progress * 10);

  let ret = '';

  for (let i = 0; i < stars; i++) ret += '*';
  for (let i = stars; i < 10; i++) ret += ' ';

  return ret;
}

// function updateOrderStats() {



//   function getOrdersFromLocation(location, algo) {

//   }
// }

getAndManageOrders(0, 22);
getAndManageOrders(1, 22);

runAndSchedule(checkOrders, 10 * 1000);

function getAndManageOrders(location, algo) {
  nh.getMyOrders(location, algo)
    .then(response => {
      const orders = response.body.result.orders;

      orders.forEach(order => {
        const {id, price, limit_speed} = order;
        console.log('Found order', id, 'on', renderLocation(location));
        manageOrder(id, parseFloat(price), Object.assign({}, config, {location, algo, limit: parseFloat(limit_speed)}), nh);
      });
    })
    .catch(error => console.error('ERROR getting and managing orders', location, algo));
}

const cheapestGreaterThan1MHAtLocation = {},
      cheapestFilledAtLocation = {};

function checkLocationOrders(location, algo) {
  nh.getOrders(location, algo)
    .then((result) => {
      const orders = result.body.result.orders.filter(order => order.type === 0);
      let cheapestFilled = orders[0],
          cheapestGreaterThan1MH = orders[0];

      cheapestFilledAtLocation[location] = cheapestFilled;
      cheapestGreaterThan1MHAtLocation[location] = cheapestGreaterThan1MH;

      orders.forEach(order => {
        if (order.workers > 0 && parseFloat(order.price) < parseFloat(cheapestFilled.price)) {
          cheapestFilled = order;
          cheapestFilledAtLocation[location] = order;
        }
        if (order.workers > 0 && parseFloat(order.price) < parseFloat(cheapestGreaterThan1MH.price) && parseFloat(order.accepted_speed) * 1000 > 1) {
          cheapestGreaterThan1MH = order;
          cheapestGreaterThan1MHAtLocation[location] = order;
        }
      });

      printOrdersSummary(location, algo, orders);
    })
    .catch(error => console.log('error getting orders', location, algo, error));
}

function printOrdersSummary(location, algo, orders = []) {
  const total_speed = orders.reduce((sum, {accepted_speed}) => sum + parseFloat(accepted_speed) * 1000, 0);

  const cheapestFilled = cheapestFilledAtLocation[location],
        cheapestGreaterThan1MH = cheapestGreaterThan1MHAtLocation[location];

  console.log(`[Cheapest > 1MH/s: ${cheapestGreaterThan1MH.price} (${(parseFloat(cheapestGreaterThan1MH.accepted_speed) * 1000).toFixed(2)} MH/s)]`, `[${renderLocation(location)}]`, `[${calculateROI(lastDifficulty, parseFloat(cheapestGreaterThan1MH.price) + 0.0001, trtlSatoshiPrice).toFixed(3)} ROI]`, renderAlgo(algo), `[${orders.length} orders]`, `(${total_speed.toFixed(2)} MH/s)`);
}

function checkOrders() {
  checkLocationOrders(0, algo);
  checkLocationOrders(1, algo);
}

let lastDifficulty = 500000000;
// function checkDifficulty(start, stop) {
//   getDifficulty()
//     .then((difficulty : number) => {
//       console.log('Current difficulty:', difficulty);

//       if (difficulty < threshold) {
//         start(difficulty);
//       }
//       else {
//         stop();
//       }
//     })
//     .catch(error => {
//       console.error('Error getting difficulty', error);
//     });
// }

function getDifficulty() {
  return new Promise((resolve, reject) => {
    fetchUrl('http://159.65.34.150:8117/live_stats', (error, meta, body) => {
      if (error) return reject(error);

      const data = JSON.parse(body.toString()),
            {network: {difficulty}} = data;

      lastDifficulty = difficulty;

      resolve(parseInt(difficulty));
    });
  });
}


function manageOrder(order, price, {threshold, roiThreshold, roiEndThreshold, limit, minimumMineTime, location, algo}, nh) {
  const orderData = {order, limit, location, algo, price};

  runAndSchedule(checkAndRunROI, 4 * 1000);
  // runAndSchedule(priceReducer, (10 * 60 + 1) * 1000);

  function checkAndRunROI() {checkROI(startNiceHash, slowNiceHash);}
  function checkAndRunROITest() {checkROI(startNiceHashTest, slowNiceHashTest);}

  function priceReducer() {
    const cheapestPrice = parseFloat(cheapestGreaterThan1MHAtLocation[location].price);
    if (orderData.price > (cheapestPrice + 0.0002)) {
      console.log('Reducing Price on', order, 'new price', price - 0.0001);
      // nh.setOrderPrice({
      //   location,
      //   algo,
      //   order,
      //   price: price - 0.0001
      // })
      //   .then(response => {
      //     price = price - 0.0001;
      //   })
      //   .catch(error => {
      //     console.log('ERROR set order price reducer', error);
      //   });
    }
  }

  function checkROI(start, stop) {
    getDifficulty()
      .then((difficulty : number) => {
        lastDifficulty = difficulty;
        const roi = calculateROI(difficulty, price, trtlSatoshiPrice);

        if (roi > roiThreshold) start(difficulty);
        else if (roi < roiEndThreshold) stop();
        console.log(`[${renderLocation(location)}] [${roi.toFixed(3)} ROI] [${price}] [order ${order}] [limit ${orderData.limit}] [${difficulty} difficulty]`);
      })
      .catch(error => {
        console.error('Error getting difficulty (ROI)', error);
      });
  }

  let startTime;
  function startNiceHash(difficulty) {
    startTime = new Date().getTime();

    const newLimit = getLimit(difficulty);


    if ((newLimit === 0 && orderData.limit !== newLimit) || newLimit > orderData.limit) {
      console.log('starting', orderData.order, newLimit);

      setOrderLimit(newLimit)
        .then(response => {
          console.log('order limit response', response.body, response.body.result.success);

          if (response.body.result.success || response.body.result.error === 'This limit already set.') {
            console.log('new order limit set:', newLimit);
            orderData.limit = newLimit;
          }
        })
        .catch(error => {
          console.log('error setting order limit', error);
        });
    }

    const price = parseFloat(cheapestGreaterThan1MHAtLocation[location].price) + 0.0002;
    if (orderData.price < price) {
      nh.setOrderPrice({location, algo, order, price})
        .then(response => {
          console.log('set order price response', response.body);
          orderData.price = price;
        })
        .catch(error => {
          console.log('error setting price', error);
        });
    }
  }

  function slowNiceHash() {
    if (new Date().getTime() - startTime > minimumMineTime && orderData.limit !== 0.01) {
      console.log('slowing order');
      setOrderLimit(0.01)
        .then(response => {
          orderData.limit = limit;
          console.log('order limit reponse', response.body);
        })
        .catch(error => {
          console.log('error setting order limit', error);
        });
    }
  }

  function setOrderLimit(limit) {
    return nh.setOrderLimit({
      order,
      location,
      algo,
      limit
    });
  }

  function startNiceHashTest(difficulty) {
    startTime = new Date().getTime();
    console.log('start nice hash', getLimit(difficulty));
  }

  function slowNiceHashTest() {
    if (new Date().getTime() - startTime > minimumMineTime) console.log('slow nicehash');
  }

  function getLimit(difficulty) {
    return 0;
  }
}

function renderLocation(location) {
  return location === 0 ? 'EUR' : 'USA';
}

function renderAlgo(algo) {
  return algo === 22 ? 'CryptoNight' : 'unknown algo';
}

const networkReward = 29656;
function calculateROI(difficulty, niceHashBTCPrice, trtlSatoshiPrice = 6) {
  const payout = (1000000 * 86400) / difficulty * networkReward,
        cost = niceHashBTCPrice / trtlSatoshiPrice * 100000000,
        profit = payout - cost,
        roi = profit /cost;

  return roi;
}

function runAndSchedule(fn, interval) {
  setInterval(fn, interval);
  fn();
}
