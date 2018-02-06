const order = 568104;
const threshold = 300000000;
const limit = 0;
const minimumMineTime = 60 * 1000;

const location = 1,
      algo = 22;


import {exec, spawn} from 'child_process';
import {fetchUrl} from 'fetch';

import * as nicehash from 'nicehash';

const nh = new nicehash({apiId: '1233015', apiKey: 'f3848d78-a9a7-ce34-afda-a888dcbad2f3'});


// runAndSchedule(checkAndRun, 10 * 1000);
// runAndSchedule(checkAndRunTest, 10 * 1000);
runAndSchedule(checkOrders, 30 * 1000);

function runAndSchedule(fn, interval) {
  setInterval(fn, interval);
  fn();
}

function checkAndRun() {
  checkDifficulty(startNiceHash, slowNiceHash);
}

function checkAndRunTest() {
  checkDifficulty(startNiceHashTest, slowNiceHashTest);
}

function checkOrders() {
  checkLocationOrders(0, algo);
  checkLocationOrders(1, algo);
}

function checkLocationOrders(location, algo) {
  nh.getOrders(location, algo)
    .then(({body}) => printOrdersSummary(location, algo, body.result.orders))
    .catch(error => console.log('error getting orders', location, algo, error));
}

function printOrdersSummary(location, algo, orders) {
  const total_speed = orders.reduce((sum, {accepted_speed}) => sum + parseFloat(accepted_speed) * 1000, 0);


  let cheapestFilled = orders[0];

  orders.forEach(order => {
    if (order.workers > 0 && parseFloat(order.price) < parseFloat(cheapestFilled.price)) cheapestFilled = order;
  });

  // console.log('Cheapest filled order', renderLocation(location), renderAlgo(algo), cheapestFilled);

  console.log({
    location: renderLocation(location),
    algo: renderAlgo(algo),
    orders: orders.length,
    total_speed,
    cheapest_filled: {
      price: cheapestFilled.price,
      workers: cheapestFilled.workers,
      accepted_speed: parseFloat(cheapestFilled.accepted_speed) * 1000,
      alive: cheapestFilled.alive
    }
  });
  // orders.forEach(({accepted_speed}) => {
  //   if (parseFloat(accepted_speed) * 1000 > 0) console.log(parseFloat(accepted_speed) * 1000);
  // });
}

function renderLocation(location) {
  return location === 0 ? 'Europe' : 'USA';
}

function renderAlgo(algo) {
  return algo === 22 ? 'CryptoNight' : 'unknown algo';
}

function checkDifficulty(start, stop) {
  getDifficulty()
    .then(difficulty => {
      console.log('Current difficulty:', difficulty);

      if (difficulty < threshold) {
        console.log('threshold met');
        start(difficulty);
      }
      else {
        console.log('threshold not met');
        stop();
      }
    })
    .catch(error => {
      console.error('Error getting difficulty', error);
    });
}

function getDifficulty() {
  return new Promise((resolve, reject) => {
    fetchUrl('http://159.65.34.150:8117/live_stats', (error, meta, body) => {
      if (error) return reject(error);

      const data = JSON.parse(body.toString()),
            {network: {difficulty}} = data;

      resolve(parseInt(difficulty));
    });
  });
}

let startTime;
function startNiceHash(difficulty) {
  startTime = new Date().getTime();

  setOrderLimit(getLimit(difficulty))
    .then(response => {
      console.log('order limit reponse', response.body);
    })
    .catch(error => {
      console.log('error setting order limit', error);
    });
}

function slowNiceHash() {
  if (new Date().getTime() - startTime > minimumMineTime) {
    console.log('slowing order');
    setOrderLimit(0.01)
      .then(response => {
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
  return limit;
}

// const what = nh.getMyOrders(1, 22)
//                .then(response => {
//                  const r = response.body.result.orders;

//                  console.log('r', r);
//                })
//                .catch(error => console.error(error));


// const order = 542651;
// let limit = 0.02;

// increaseLimit();
// setInterval(increaseLimit, (60 * 1000) / 2);


// function increaseLimit() {
//   nh.setOrderLimit({
//     location: 1,
//     algo: 22,
//     limit,
//     order
//   })
//   .then(response => {
//     console.log('next limit', limit, response.body);
//   })
//   .catch(error => {
//     console.log('error setting limit', error);
//   });

//   limit += 0.02;
// }


