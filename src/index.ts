const apiId = '1233015',
      apiKey = '';

import {createAPI} from './apiInterfaces';

const {rpcWallet, rpcDaemon, daemonGetInfo} = createAPI({host: '127.0.0.1', port: 11898}, {host: '127.0.0.1', port: 9999});


runAndSchedule(transferWalletToTradeOgre, 60 * 1000);

function transferWalletToTradeOgre() {
  rpcWallet('getbalance', {'address': 'TRTLv1W1So77yGbVtrgf8G4epg5Fhq9hEZvpZC8ev86xRVLYsQQMHrxQG92QVjUU3bcE6ThGw9vSbEHBMejJpexE2sdrTC24ZXR',}, (error, response) => {
    if (error) return console.error('error getting balance', error);

    const {available_balance, locked_amount} = response;

    console.log(`$$$$$$$$$$$$ Wallet Balance: ${(available_balance/100).toFixed(2)} available, ${(locked_amount/100).toFixed(2)} locked ||| ${((available_balance + locked_amount) / 100).toFixed(2)} total $$$$$$$$$$$$`);

    if (available_balance >  100) {
      const toSend = available_balance - 10,
            turtleBag_amount = Math.floor(toSend * 0.02),
            wallet_amount = toSend - turtleBag_amount;
      rpcWallet('transfer', {
        'payment_id': 'face2014b18dbf6fb7f32ed3d14203cb6c50c54572387ce55abb5b50567bae7e',
        'mixin': 4,
        'fee': 10,
        'destinations': [{
          'address': 'TRTLv1Hqo3wHdqLRXuCyX3MwvzKyxzwXeBtycnkDy8ceFp4E23bm3P467xLEbUusH6Q1mqQUBiYwJ2yULJbvr5nKe8kcyc4uyps',
          'amount': wallet_amount
        },{
          'address': 'TRTLuzWZbe7VvbPfTg2XcJfqL26vsBE3MK45LUd3HAYtRbi7feyArC3THhaoSRABsvMrp7XRRDcH8Y8R4FJ2Zr7cEFfyxqRm6jS',
          'amount': turtleBag_amount
        }]
      }, (error, response) => {
        if (error) return console.error('error transferring', error);

        console.log(`-------->>>>>>>> ${(wallet_amount - 10) / 100} to tradeogre!`);
        console.log(`-------->>>>>>>> ${(turtleBag_amount - 10) / 100} to turtlebag!`);
      });
    }
  });
}

const config = {
        threshold: 300000000,
        roiThreshold: 0.2,
        roiEndThreshold: 0.19,
        limit: 1,
        minimumMineTime: 0,
        roiSchedules: [
          {roi: 2.4, limit: 0},
          {roi: 2.3, limit: 5.75},
          {roi: 2.2, limit: 5.5},
          {roi: 2.1, limit: 5.25},
          {roi: 2.0, limit: 5},
          {roi: 1.9, limit: 4.75},
          {roi: 1.8, limit: 4.5},
          {roi: 1.7, limit: 4.25},
          {roi: 1.6, limit: 4},
          {roi: 1.5, limit: 3.75},
          {roi: 1.4, limit: 3.5},
          {roi: 1.3, limit: 3.25},
          {roi: 1.2, limit: 3},
          {roi: 1.1, limit: 2.75},
          {roi: 1.0, limit: 2.5},
          {roi: 0.9, limit: 2.25},
          {roi: 0.8, limit: 2},
          {roi: 0.7, limit: 1.75},
          {roi: 0.6, limit: 1.5},
          {roi: 0.5, limit: 1.25},
          {roi: 0.4, limit: 1},
          {roi: 0.3, limit: 0.75},
          {roi: 0.2, limit: 0.5},
          {roi: 0.1, limit: 0.25}
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

const managedOrders = [];
const latestOrders = {
  '0': {
    22: []
  },
  '1': {
    22: []
  }
};

let trtlSatoshiPrice = 4;

const algo = 22;

function calculateLimit(roi) {
  if (roi < 0.2) return 0.01;
  // else if (roi < 2.4) return roi - 0.1;
  else if (roi < 2.4) return (0.5 + ((roi - 0.2) / 0.1) * 0.25) / managedOrders.length;
  return 0;
}

function pickSchedule(schedules, roi) {
  for (let i = 0; i < schedules.length; i++) {
    var schedule = schedules[i];
    if (roi > schedule.roi) return schedule;
  }
}

// function updateNiceHashOrder(orderData, limit, price) {
//   if (orderData.limit !== limit) {
//     setOrderLimit(orderData, limit)
//       .catch(error => {
//         console.log('Error updating order limit', error, orderData, limit);
//         setTimeout(() => updateNiceHashOrder(orderData, limit, price), 1000);
//       });
//   }

//   if (orderData.price !== price) {
//     setOrderPrice(orderData, price)
//       .catch(error => {
//         console.log('Error updating order price', error, orderData, price);
//         setTimeout(() => updateNiceHashOrder(orderData, limit, price), 1000);
//       });
//   }
// }

// function setOrderLimit(orderData, limit) {
//   console.log(`Setting [${orderData.order}] limit to ${limit}`);
//   setOrderLimit(limit)
//     .then(response => {

//       if (response.body.result.success || response.body.result.error === 'This limit already set.') {
//         console.log('new order limit set:', limit);
//         orderData.limit = limit;
//       }
//     })
//     .catch(error => {
//       console.log('error setting order limit', error);
//     });
// }

// function setOrderPrice(orderData, price) {
//   const {location, algo, order} = orderData;

//   console.log(`Setting [${order}] price to ${price}`);

//   nh.setOrderPrice({location, algo, order, price})
//     .then(response => {
//       console.log('set order price response', response.body);
//       if (response.body.result.success) {
//         orderData.price = price;
//       }
//     })
//     .catch(error => {
//       console.log('error setting price', error);
//     });
// }

// function pickSchedule(schedules, roi, currentRun) {

// }

import * as EventEmitter from 'events';

import * as nicehash from 'nicehash';

import {fetchUrl} from 'fetch';

const nh = new nicehash({apiId, apiKey});

const difficultyEmitter = new EventEmitter(),
      cheapestEmitter = new EventEmitter();

function nhRequest(request, args) {
  return nh[request](...args).catch(error => {
    console.error('nhRequest error', request, args, error);
  });
}

runAndSchedule(checkDifficulty, 1 * 500);
runAndSchedule(checkTRTLPrice, 30 * 1000);

difficultyEmitter.once('difficulty', () => {
  runAndSchedule(checkOrders, 10 * 1000);
  // runAndSchedule(projectDifficulty, 10 * 1000);

  runAndSchedule(() => updateOrdersStats(0, algo), 10 * 1000);
  runAndSchedule(() => updateOrdersStats(1, algo), 10 * 1000);

  getAndManageOrders(0, 22);
  getAndManageOrders(1, 22);
});

difficultyEmitter.on('difficulty', () => {
  printOrders(0, algo);
  printOrders(1, algo);
});


let difficultyErrorCount = 0,
    lastBlock = new Date().getTime();
function checkDifficulty() {
  getDifficulty()
    .then(([difficulty, height] : [number, number]) => {
      difficultyErrorCount = 0;
      let timeSinceLast = new Date().getTime() - lastBlock;
      if (lastHeight !== height) {
        lastBlock = new Date().getTime();
        lastHeight = height;
      }
      if (lastDifficulty !== difficulty) {
        const diff = difficulty - lastDifficulty;
        const secondsSinceLast = (timeSinceLast / 1000).toFixed(1);
        if (diff > 0) {
          console.log(`^^^^^^^^ Difficulty: ${difficulty} (${difficulty > lastDifficulty ? '+' : ''}${difficulty - lastDifficulty})(${difficulty > lastDifficulty ? '+' : ''}${((difficulty - lastDifficulty) / lastDifficulty * 100).toFixed(2)}%)| |${height} height| (${secondsSinceLast} s [${(timeSinceLast / (30 * 10)).toFixed(2)}%]) ^^^^^^^^`);
        }
        else if (diff < 0) {
          console.log(`vvvvvvvv Difficulty: ${difficulty} (${difficulty > lastDifficulty ? '+' : ''}${difficulty - lastDifficulty})(${difficulty > lastDifficulty ? '+' : ''}${((difficulty - lastDifficulty) / lastDifficulty * 100).toFixed(2)}%)| |${height} height| (${secondsSinceLast} s [${(timeSinceLast / (30 * 10)).toFixed(2)}%]) vvvvvvvv`);
        }
        else {
          console.log(`======== Difficulty: ${difficulty} (${difficulty > lastDifficulty ? '+' : ''}${difficulty - lastDifficulty})(${difficulty > lastDifficulty ? '+' : ''}${((difficulty - lastDifficulty) / lastDifficulty * 100).toFixed(2)}%)| |${height} height| (${secondsSinceLast} s [${(timeSinceLast / (30 * 10)).toFixed(2)}%]) ========`);
        }
        lastDifficulty = difficulty;
        difficultyEmitter.emit('difficulty', difficulty);
      }
    })
    .catch(error => {
      difficultyErrorCount++;

      if (difficultyErrorCount > 1) {
        slowAllOrders();
      }
      console.log('error getting difficulty', error);
    });
}

function slowAllOrders() {
  console.log('************* SLOWING ALL ORDERS!', managedOrders);
  managedOrders.forEach(({order, location, algo}) => {
    return nh.setOrderLimit({
      order,
      location,
      algo,
      limit: 0.01
    })
    .then(response => {
      console.log('slowed all orders response', response.body);
    })
    .catch(error => {

    });
  });
}

function checkTRTLPrice() {
  fetchUrl('https://tradeogre.com/api/v1/orders/BTC-TRTL', (error, meta, body) => {
    if (error) return console.error('Error checking TRTL price', error);

    const {buy} = JSON.parse(body.toString());

    const prices = Object.keys(buy).map(key => {
      const [f, s] = key.split('.'),
            satoshis = parseInt(f) * 100000000 + parseInt(s);
      return satoshis;
    });

    prices.sort().reverse();

    if (prices.length > 0 && prices[0] !== trtlSatoshiPrice) {
      trtlSatoshiPrice = prices[0];
    }

    console.log('TRTL PRICE:', trtlSatoshiPrice);
  });
}

const difficultyWindow = 17;
function projectDifficulty() {
  getBlocksInfo()
    .then((data : any) => {
      if (data.error) {
        console.log('Error retrieving blocks', data);
      }
      else {
        const {blocks} = data.result;

        const losingTime = blocks[difficultyWindow - 2].timestamp - blocks[difficultyWindow - 1].timestamp,
              gainingTime = new Date().getTime() - (blocks[0].timestamp * 1000),
              timeDifference = (gainingTime - losingTime) / 1000;

        console.log({losingTime, gainingTime, timeDifference});

        // const window = blocks.slice(difficultyWindow),
        //       previousWork = blocks[difficultyWindow-1].height * 30 * 1000,
        //       recentWork = window.reduce((sum, block) => sum + block.difficulty, 0),
        //       totalWork = previousWork + recentWork,
        //       target = totalWork * 30 * 1000,
        //       blockTime = blocks[0].timestamp * 1000 - blocks[16].timestamp * 1000,
        //       time = new Date().getTime() - ((blocks[8].timestamp * 1000) + 7 * 60 * 60 * 1000 + new Date().getTimezoneOffset() * 60 * 1000);

        // console.log('projected difficulty', (target / time).toFixed(0), blockTime, time, new Date((blocks[0].timestamp * 1000) + 7 * 60 * 60 * 1000 + new Date().getTimezoneOffset() * 60 * 1000), new Date());

        //, totalWork, target, time, blockTime, new Date().getTime(), blocks[16].timestamp * 1000, new Date(), new Date(blocks[16].timestamp * 1000), new Date().getTimezoneOffset()
      }
    })
    .catch(error => console.log('error getting blocks info', error));
}

function getBlocksInfo() {
  return new Promise((resolve, reject) => {
    fetchUrl('https://blocks.turtle.link/daemon/json_rpc', {method: 'POST', payload: '{"jsonrpc":"2.0","id":"test","method":"f_blocks_list_json","params":{"height":170801}}:'}, (error, meta, body) => {
      if (error) return reject(error);

      try {
        const data = JSON.parse(body.toString());
        resolve(data);
      }
      catch (error) {
        return reject(error);
      }6

    });
  });
}

function getAndManageOrders(location, algo) {
  nh.getMyOrders(location, algo)
    .then(response => {
      const orders = response.body.result.orders;

      orders.forEach(order => {
        const {id, price, limit_speed} = order;
        manageOrder(id, parseFloat(price), Object.assign({}, config, {location, algo, limit: parseFloat(limit_speed)}), nh);
      });
    })
    .catch(error => console.error('ERROR getting and managing orders', location, algo, error));
}

const cheapestGreaterThan1MHAtLocation = {},
      cheapestFilledAtLocation = {};

function checkLocationOrders(location, algo) {
  nh.getOrders(location, algo)
    .then((result) => {
      const orders = result.body.result.orders.filter(order => order.type === 0).sort((a, b) => parseFloat(a.price) > parseFloat(b.price) ? -1 : 1);

      latestOrders[location][algo] = orders;

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

      cheapestEmitter.emit('updated');

      printOrdersSummary(location, algo, orders);
    })
    .catch(error => console.log('error getting orders', location, algo, error));
}

const summaryPrints = {
  0: {
    22: ''
  },
  1: {
    22: ''
  }
};

function printOrdersSummary(location, algo, orders = []) {
  const total_speed = orders.reduce((sum, {accepted_speed}) => sum + parseFloat(accepted_speed) * 1000, 0);

  const cheapestFilled = cheapestFilledAtLocation[location],
        cheapestGreaterThan1MH = cheapestGreaterThan1MHAtLocation[location];

  const s = `[Cheapest > 1MH/s: ${cheapestGreaterThan1MH.price} (${(parseFloat(cheapestGreaterThan1MH.accepted_speed) * 1000).toFixed(2)} MH/s)] [${renderLocation(location)}] [${calculateROI(lastDifficulty, parseFloat(cheapestGreaterThan1MH.price) + 0.0001, trtlSatoshiPrice).toFixed(3)} ROI] ${renderAlgo(algo)} [${orders.length} orders] (${total_speed.toFixed(2)} MH/s)`;

  if (s != summaryPrints[location][algo]) console.log(s);
  summaryPrints[location][algo] = s;
}

function checkOrders() {
  checkLocationOrders(0, algo);
  checkLocationOrders(1, algo);
}

let lastDifficulty = 500000000,
    lastHeight = 0;
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
    daemonGetInfo((error, response) => {
      if (error) return reject(error);//return console.error('getinfo error', error);
      // console.log(response);
      resolve([response.difficulty, response.height]);
    });
  });
}

function throttle(fn, time) {
  let started = 0;

  return (...args) => {
    const now = new Date().getTime();

    if ((now - started) > time) {
      started = now;
      return fn(...args);
    }
  }
}

function manageOrder(order, price, {threshold, roiThreshold, roiEndThreshold, limit, minimumMineTime, location, algo}, nh) {
  console.log('Now managing', order, 'on', renderLocation(location));
  let startTime;

  const orderData = {order, limit, location, algo, price};

  // const throttledStart = throttle(startNiceHash, 500);

  managedOrders.push(orderData);

  difficultyEmitter.on('difficulty', difficulty => checkROIWithDifficulty(difficulty, startNiceHash, slowNiceHash));
  cheapestEmitter.on('updated', () => checkROIWithDifficulty(lastDifficulty, startNiceHash, slowNiceHash));

  checkROIWithDifficulty(lastDifficulty, startNiceHash, slowNiceHash);

  // runAndSchedule(checkAndRunROI, 4 * 1000);
  // setTimeout(() => runAndSchedule(priceReducer, (10 * 60 + 1) * 1000), 5000);

  function priceReducer() {
    const cheapest = cheapestGreaterThan1MHAtLocation[location];
    if (cheapest) {
      const cheapestPrice = parseFloat(cheapest.price);
      if (orderData.price > (cheapestPrice + 0.0002)) {
        console.log('Reducing Price on', order, 'new price', price - 0.0001);
        nh.setOrderPrice({
          location,
          algo,
          order,
          price: price - 0.0001
        })
          .then(response => {
            console.log('price reduction response', response.body.result);
            if (response.body.result.success) orderData.price = price - 0.0001;
          })
          .catch(error => {
            console.log('ERROR set order price reducer', error);
          });
      }
    }
  }

  function checkROIWithDifficulty(difficulty, start, stop) {
    const roi = calculateROI(difficulty, orderData.price, trtlSatoshiPrice);
    start(difficulty, roi);
  }

  function startNiceHash(difficulty, roi) {
    startTime = new Date().getTime();

    const newLimit = calculateLimit(roi);

    if (newLimit !== orderData.limit) {
      // console.log('starting', orderData.order, newLimit.toFixed(2));

      setOrderLimit(newLimit)
        .then(response => {
          if (response.body.result.success || response.body.result.error === 'This limit already set.') {
            console.log('new order limit set:', newLimit.toFixed(2));
            orderData.limit = newLimit;
          }
        })
        .catch(error => {
          console.log('error setting order limit', error, limit);
        });
    }

    setTimeout(() => {
      const price = parseFloat(cheapestGreaterThan1MHAtLocation[location].price) + 0.0002;
      if (orderData.price < price) {
        nh.setOrderPrice({location, algo, order, price})
          .then(response => {
            console.log('set order price response', response.body);
            if (response.body.result.success) orderData.price = price;
          })
          .catch(error => {
            console.log('error setting price', error);
          });
      }
    }, 1500);
  }

  function slowNiceHash() {
    if (new Date().getTime() - startTime > minimumMineTime && orderData.limit !== 0.01) {
      console.log('slowing order');
      setOrderLimit(0.01)
        .then(response => {
          if (response.result.success) orderData.limit = 0.01;
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

  function startNiceHashTest(difficulty, roi) {
    startTime = new Date().getTime();
    console.log('start nice hash', {difficulty, roi});
  }

  function slowNiceHashTest() {
    if (new Date().getTime() - startTime > minimumMineTime) console.log('slow nicehash');
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

function updateOrdersStats(location, algo) {
  nhRequest('getMyOrders', [location, algo])
    .then(response => {
      const {orders} = response.body.result;

      orders.forEach(order => {
        order.location = location;
        ordersDB[location][algo][order.id] = Object.assign(ordersDB[order.id] || {}, order);
        if (!order.alive) {
          for (let i = managedOrders.length - 1; i >= 0; i--) {
            if (managedOrders[i].id === order.id) managedOrders.splice(i);
          }
        }
      });
      printOrders(location, algo);
    });
}

function printOrders(location, algo) {
  Object.values(ordersDB[location][algo]).forEach(printOrder);
}

const lastPrints = {
  '0': {
    '22': {}
  },
  '1': {
    '22': {}
  }
};

function printOrder({id, algo, btc_avail, limit_speed, price, end, workers, btc_paid, location, accepted_speed}) {
  const avail = parseFloat(btc_avail),
        paid = parseFloat(btc_paid),
        roi = calculateROI(lastDifficulty, price, trtlSatoshiPrice),
        costPerHour = (parseFloat(accepted_speed) * 1000) * price / 24,
        profitPerHour = costPerHour * (1 + roi) - costPerHour,
        {workersAbove, workersBelow} = separateWorkersOnOrder(id, location, algo, price),
        marketPosition = workersBelow / (workersAbove + workersBelow),
        s = `[${roi.toFixed(3)} ROI] [B ${price}] [B${profitPerHour.toFixed(4)}/hr] [${limit_speed} limit] [${(parseFloat(accepted_speed) * 1000).toFixed(2)} MH/s] [${workers} w (${(marketPosition * 100).toFixed(1)}%)] [${renderProgress(1 - (avail / (avail + paid)))}] [${avail.toFixed(5)} avail] ${renderLocation(location)} ${id}`;


  if (s != lastPrints[location][algo][id]) console.log(s);

  lastPrints[location][algo][id] = s;
}

function separateWorkersOnOrder(id, location, algo, price) {
  const orders = latestOrders[location][algo];

  let workersAbove = 0, workersBelow = 0;

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];

    if (parseFloat(order.price) > parseFloat(price)) workersAbove += order.workers;
    if (parseFloat(order.price) < parseFloat(price)) workersBelow += order.workers;
  }

  return {workersAbove, workersBelow};
}

function renderProgress(progress) {
  const stars = Math.floor(progress * 10);

  let ret = '';

  for (let i = 0; i < stars; i++) ret += '*';
  for (let i = stars; i < 10; i++) ret += ' ';

  return ret;
}