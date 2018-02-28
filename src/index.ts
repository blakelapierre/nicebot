import * as querystring from 'querystring';
import * as EventEmitter from 'events';
import * as https from 'https';

import * as nicehash from 'nicehash';

import {fetchUrl} from 'fetch';

import {createAPI} from './apiInterfaces';

import chalk from 'chalk';


const apiId = process.env['API_ID'],
      apiKey = process.env['API_KEY'],
      TO_PUBLIC = process.env['TO_PUBLIC'],
      TO_PRIVATE = process.env['TO_PRIVATE'];

const nh = new nicehash({apiId, apiKey});

const {rpcWallet: trtlWallet, rpcDaemon, daemonGetInfo} = createAPI({host: '127.0.0.1', port: 11898}, {host: '127.0.0.1', port: 9999});
const {rpcWallet: masterCollectorWallet} = createAPI({host: '127.0.0.1', port: 11898}, {host: '127.0.0.1', port: 9998});
const {rpcWallet: stlWallet, rpcDaemon: stlDaemon, daemonGetInfo: stlDaemonGetInfo} = createAPI({host: '127.0.0.1', port: 7777}, {host: '127.0.0.1', port: 7779});
const {rpcWallet: etnWallet, rpcDaemon: etnDaemon, daemonGetInfo: etnDaemonGetInfo} = createAPI({host: '127.0.0.1', port: 8888}, {host: '127.0.0.1', port: 8889});
const {rpcWallet: msrWallet, rpcDaemon: msrDaemon, daemonGetInfo: msrDaemonGetInfo} = createAPI({host: '127.0.0.1', port: 9988}, {host: '127.0.0.1', port: 9989});


const ordersDB = ['TRTL', 'ETN', 'STL', 'DER', 'MSR', 'ITNS', 'unknown'].reduce((db, coin) => (db[coin] = {'0': {22: []}, '1': {22: []}}, db), {});

const difficultiesErrorCount = {
  'TRTL': 0,
  'ETN': 0,
  'STL': 0,
  'DER': 0,
  'MSR': 0,
  'ITNS': 0
};

const lastDifficulties = {
  'TRTL': undefined,
  'ETN': undefined,
  'STL': undefined,
  'DER': undefined,
  'MSR': undefined,
  'ITNS': undefined
};

const lastBlocks = {
  'TRTL': 0,
  'ETN': 0,
  'STL': 0,
  'DER': 0,
  'MSR': 0,
  'ITNS': 0
};

const lastHeights = {
  'TRTL': 0,
  'ETN': 0,
  'STL': 0,
  'DER': 0,
  'MSR': 0,
  'ITNS': 0
};

const currentExchange = {
  'TRTL': 'tradeogre',
  'ETN': 'tradeogre',
  'STL': 'tradeogre',
  'DER': 'cryptopia',
  'MSR': 'stocks.exchange',
  'ITNS': 'stocks.exchange'
};

const pricingStrategies = {
  'TRTL': ({location, algo, newLimit}) => (stringToSatoshis((getCheapestFilledAtLimit(location, algo, newLimit) || {price: 0}).price) + 20000) / 100000000,
  'ETN': ({price}) => price,
  'STL': ({price}) => price,
  'DER': ({price}) => price,
  'MSR': ({price}) => price,
  'ITNS': ({price}) => price
};

const exchanges = {
  'tradeogre': {coins: ['TRTL', 'ETN', 'STL', 'BTC']},
  'stocks.exchange': {coins: ['MSR']}
};

const exchangePrices = {
  'tradeogre': {},
  'cryptopia': {},
  'stocks.exchange': {'MSR':1420}
};

const coinStatus = {
  'TRTL': {selling: true},
  'ETN': {selling: true},
  'STL': {selling: true},
  'DER': {selling: false},
  'MSR': {selling: false},
  'ITNS': {selling: false},
  'BTC': {selling: false}
};

const managedOrders = {'TRTL': [], 'ETN': [], 'STL': [], 'DER': [], 'MSR': [], 'ITNS': []};


const latestOrders = {
  '0': {
    22: []
  },
  '1': {
    22: []
  }
};

const algo = 22;


runAndSchedule(transferWalletToTradeOgre, 60 * 1000);
// runAndSchedule(transferWalletToTradeSatoshi, 60 * 1000);
runAndSchedule(transferStelliteWalletToTradeOgre, 60 * 5 * 1000);
// runAndSchedule(transferEtnWalletToTradeOgre, 60 * 1000);
runAndSchedule(transferEtnWalletToCryptopia, 60 * 1000);

// setTimeout(() => runAndSchedule(transferWalletToTradeSatoshi, 60 * 1000), 30 * 1000);
// runAndSchedule(transferToCollectors, 0.2 * 1000);

runAndSchedule(checkNiceHashBalance, 60 * 1000);

runAndSchedule(checkTradeOgreBalances, 60 * 1000);

function checkTradeOgreBalances() {
  exchanges['tradeogre'].coins.forEach(coin => {
    getTradeOgreBalance(coin)
      .then(({balance, available}) => {
        console.log(`${chalk.blue('tradeogre')} ${printCoin(coin)} balance ${balance}, available ${parseFloat(available) > 0 ? chalk.yellow(available) : available}`);

        if (coinStatus[coin].selling) {
          console.log(available, exchangePrices['tradeogre'][coin])
          if (parseFloat(available) * exchangePrices['tradeogre'][coin] >= 10000) {
            submitTradeOgreSellOrder(`BTC-${coin}`, available, `0.${exchangePrices['tradeogre'][coin].toString().padStart(8, '0')}`)
              .then(response => console.log(`tradeogre sell result ${coin} ${JSON.stringify(response)}`))
              .catch(error => console.error(`error selling ${available} ${coin} on tradeogre`, error))
          }
        }
      })
      .catch(error => console.error(`Error getting tradeogre ${printCoin(coin)} balance`, error));
  });
}

function submitTradeOgreSellOrder(market, quantity, price) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify({market, quantity, price}),
          authKey = new Buffer(`${TO_PUBLIC}:${TO_PRIVATE}`).toString('base64');

    const request = https.request({
      host: 'tradeogre.com',
      port: 443,
      method: 'POST',
      path: '/api/v1/order/sell',
      headers: {
        'Authorization': `Basic ${authKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': body.length
      }
    }, response => {
      let result = '';
      response.on('data', chunk => result += chunk);
      response.on('end', () => resolve(JSON.parse(result)));
      response.on('error', reject);
    });

    request.on('error', reject);

    request.write(body);
    request.end();
  });
}

function getTradeOgreBalance(symbol) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify({currency: symbol}),
          authKey = new Buffer(`${TO_PUBLIC}:${TO_PRIVATE}`).toString('base64');

    const request = https.request({
      host: 'tradeogre.com',
      port: 443,
      method: 'POST',
      path: '/api/v1/account/balance',
      headers: {
        'Authorization': `Basic ${authKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': body.length
      }
    }, response => {
      let result = '';
      response.on('data', chunk => result += chunk);
      response.on('end', () => resolve(JSON.parse(result)));
      response.on('error', reject);
    });

    request.on('error', reject);

    request.write(body);
    request.end();
  });
}

function checkNiceHashBalance() {
  nh
    .getMyBalance()
    .then(response => {
      const {balance_confirmed: confirmed, balance_pending: pending} = response.body.result,
            total = stringToSatoshis(confirmed) + stringToSatoshis(pending);

      console.log('Nice hash balance:', {confirmed, pending, total: total / 100000000});
    })
    .catch(error => console.error('Error checking NiceHash balance', error));
}

const collectors = [
  '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'
];

const collectorAmount = 1;


function transferStelliteWalletToTradeOgre() {
  const wallet = stlWallet;

  wallet('getbalance', {}, (error, response) => {
    if (error) return console.error('error getting stellite balance', error);

    const {balance, unlocked_balance} = response;

    console.log(`${chalk.green('$$$$$$$$$$$$')} ${printCoin('STL')} Wallet Balance: ${(unlocked_balance/100).toFixed(2)} available ||| ${chalk.green((balance / 100).toFixed(2))} total ${chalk.green('$$$$$$$$$$$$')}`);

    if (unlocked_balance/100 > 1000) {
      // wallet('transfer', {
      //   'mixin': 1,
      //   'unlock_time': 0,
      //   destinations: [{
      //     'address': 'SEiStP7SMy1bvjkWc9dd1t2v1Et5q2DrmaqLqFTQQ9H7JKdZuATcPHUbUL3bRjxzxTDYitHsAPqF8EeCLw3bW8ARe8rYeorMw6p7nhasUgZ6S',
      //     'amount': unlocked_balance - 1000
      //   }]
      // }, (error, response) => {
      //   if (error) return console.error('error transfering stellite wallet', error);

      //   console.log('stellite transfer response', response);
      // });
      // wallet('sweep_all', {
      //   'address': 'SEiStP7SMy1bvjkWc9dd1t2v1Et5q2DrmaqLqFTQQ9H7JKdZuATcPHUbUL3bRjxzxTDYitHsAPqF8EeCLw3bW8ARe8rYeorMw6p7nhasUgZ6S',
      //   'mixin': 1,
      //   'priority': 3,
      //   'unlock_time': 0
      // }, (error, response) => {
      //   if (error) return console.error('error sweeping stellite wallet', error);
      //   if (response.tx_hash_list) console.log('swept stellite wallet', 'tx ids', response.tx_hash_list);
      // });
    }
  });


}

function transferEtnWalletToTradeOgre() {
  const wallet = etnWallet;

  wallet('sweep_all', {
    'address': 'f4VR74XR616Tw2wAMMfaLV1vmYBSBBbmWXBUtaV8YDb6DHsfKRoYkFaCvhPhsGDDfm1afhzLNuf5XGFmNrvodPoQ6m4qLBtqrK15ZQg4neRYH',
    'mixin': 1,
    'unlock_time': 0
  }, (error, response) => {
    if (error) return console.error('error sweeping etn wallet', error);

    if (response) console.log('swept etn wallet', 'tx ids', response.tx_hash_list);
  });
}

function transferEtnWalletToCryptopia() {
  const wallet = etnWallet;

  wallet('sweep_all', {
    'address': 'etnjzKFU6ogESSKRZZbdqraPdcKVxEC17Cm1Xvbyy76PARQMmgrgceH4krAH6xmjKwJ3HtSAKuyFm1BBWYqtchtq9tBap8Qr4M',
    'payment_id': '8ce7f9034e40f81f18fcb35110cf74743d730cb0d5c076c14e0676caee0dd24b',
    'mixin': 1,
    'unlock_time': 0
  }, (error, response) => {
    if (error) return console.error('error sweeping etn wallet', error);

    if (response) console.log('swept etn wallet', 'tx ids', response.tx_hash_list);
  });
}

function transferWalletToTradeOgre() {
  const wallet = trtlWallet;
  trtlWallet('getbalance', {'address': 'TRTLv1W1So77yGbVtrgf8G4epg5Fhq9hEZvpZC8ev86xRVLYsQQMHrxQG92QVjUU3bcE6ThGw9vSbEHBMejJpexE2sdrTC24ZXR'}, (error, response) => {
    if (error) return console.error('error getting balance', error);

    const {available_balance, locked_amount} = response;

    console.log(`${chalk.green('$$$$$$$$$$$$')} Wallet Balance: ${(available_balance/100).toFixed(2)} available, ${(locked_amount/100).toFixed(2)} locked ||| ${chalk.green(((available_balance + locked_amount) / 100).toFixed(2))} total ${chalk.green('$$$$$$$$$$$$')}`);

    if (available_balance >  100) {
      const toSend = available_balance - 10,
            turtlebag_amount = Math.floor(toSend * 0.02),
            mastercollector_amount = Math.floor(toSend * 0.005),
            wallet_amount = toSend - turtlebag_amount - mastercollector_amount/* - sidebag_amount*/;

        trtlWallet('transfer', {
          'payment_id': 'face2014b18dbf6fb7f32ed3d14203cb6c50c54572387ce55abb5b50567bae7e',
          'mixin': 4,
          'fee': 10,
          'unlock_time': 0,
          'destinations': [{
            'address': 'TRTLv1Hqo3wHdqLRXuCyX3MwvzKyxzwXeBtycnkDy8ceFp4E23bm3P467xLEbUusH6Q1mqQUBiYwJ2yULJbvr5nKe8kcyc4uyps',
            'amount': wallet_amount
          },{
            'address': 'TRTLuzWZbe7VvbPfTg2XcJfqL26vsBE3MK45LUd3HAYtRbi7feyArC3THhaoSRABsvMrp7XRRDcH8Y8R4FJ2Zr7cEFfyxqRm6jS',
            'amount': turtlebag_amount
          },{
            'address': 'TRTLuzHX7GC24EE3kd2poLeoZebCdUeMu8rAsMngCYWFTJwT4B9DD6ehnds1dWtjqeZmRx1yGFpNTdmw8NZ8Yq2oheZg9awb5Y7',
            'amount': mastercollector_amount
          }]
        }, (error, response) => {
          if (error) return console.error('error transferring', error);

          printTransfer((wallet_amount - 10) / 100, `tradeogre`);
          printTransfer((turtlebag_amount - 10) / 100, `turtlebag`);
          printTransfer((mastercollector_amount - 10) / 100, `mastercollector`);
        });
    }
  });
}

function transferWalletToTradeSatoshi() {
  const wallet = trtlWallet;
  wallet('getbalance', {'address': 'TRTLv1W1So77yGbVtrgf8G4epg5Fhq9hEZvpZC8ev86xRVLYsQQMHrxQG92QVjUU3bcE6ThGw9vSbEHBMejJpexE2sdrTC24ZXR'}, (error, response) => {
    if (error) return console.error('error getting balance', error);

    const {available_balance, locked_amount} = response;

    console.log(`${chalk.green('$$$$$$$$$$$$')} Wallet Balance: ${(available_balance/100).toFixed(2)} available, ${(locked_amount/100).toFixed(2)} locked ||| ${chalk.green(((available_balance + locked_amount) / 100).toFixed(2))} total ${chalk.green('$$$$$$$$$$$$')}`);

    if (available_balance >  100) {
      const toSend = available_balance - 10,
            turtlebag_amount = Math.floor(toSend * 0.02),
            mastercollector_amount = Math.floor(toSend * 0.005),
            wallet_amount = toSend - turtlebag_amount - mastercollector_amount/* - sidebag_amount*/;

        wallet('transfer', {
          'payment_id': '5d944b372b32020c3c38cd57eeb85b3fb4564229c658f8371b8548da6c983be1',
          'mixin': 4,
          'fee': 10,
          'unlock_time': 0,
          'destinations': [{
            'address': 'TRTLv3cfN9iTyBnQreoWMgS5buhuBM8Fhgzu8rLaLhJYGUXPMgXroiJHVFbjKAuaMR2EPQHcizWLc3Zcg41YxNoQ9JrYGcmvM99',
            'amount': wallet_amount
          },{
            'address': 'TRTLuzWZbe7VvbPfTg2XcJfqL26vsBE3MK45LUd3HAYtRbi7feyArC3THhaoSRABsvMrp7XRRDcH8Y8R4FJ2Zr7cEFfyxqRm6jS',
            'amount': turtlebag_amount
          },{
            'address': 'TRTLuzHX7GC24EE3kd2poLeoZebCdUeMu8rAsMngCYWFTJwT4B9DD6ehnds1dWtjqeZmRx1yGFpNTdmw8NZ8Yq2oheZg9awb5Y7',
            'amount': mastercollector_amount
          }]
        }, (error, response) => {
          if (error) return console.error('error transferring', error);

          printTransfer((wallet_amount - 10) / 100, `tradesatoshi`);
          printTransfer((turtlebag_amount - 10) / 100, `turtlebag`);
          printTransfer((mastercollector_amount - 10) / 100, `mastercollector`);
        });
    }
  });
}


function transferToCollectors() {
  const wallet = masterCollectorWallet;

  wallet('getbalance', {'address': 'TRTLuzHX7GC24EE3kd2poLeoZebCdUeMu8rAsMngCYWFTJwT4B9DD6ehnds1dWtjqeZmRx1yGFpNTdmw8NZ8Yq2oheZg9awb5Y7'}, (error, response) => {
    if (error) return console.error('error getting mastercollector balance', error);

    const {available_balance, locked_amount} = response;

    // console.log(chalk.yellow('$$$$  '), 'mastercollector balance:', available_balance, 'available, ', locked_amount, 'locked', chalk.yellow('  $$$$'));

    if (available_balance > 10 + 1 * collectors.length * 4) {
      wallet('transfer', {
        'mixin': 4,
        'fee': 10,
        'unlock_time': 0,
        'destinations': collectors.map(address => ({address, amount: 1})).concat(collectors.map(address => ({address, amount: 1}))).concat(collectors.map(address => ({address, amount: 1}))).concat(collectors.map(address => ({address, amount: 1})))
      }, (error, response) => {
        if (error) return console.error('error transfering to collectors', error);
        console.log('mastercollector disbursed to', collectors.length, 'collectors!', chalk.yellow('$$$$  '), 'mastercollector balance:', available_balance, 'available, ', locked_amount, 'locked', chalk.yellow('  $$$$'));
      });
    }
  });
}


function printTransfer(amount, destination) {
  console.log(`-------->>>>>>>> ${amount} to ${destination}!`);
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


const lowerThreshold = 0.3;
function calculateTurtleLimit(roi) {
  if (roi < lowerThreshold) return 0.01;
  // else if (roi < 2.4) return roi - 0.1;
  else if (roi < 2.4) return (0.5 + /*0.5 + */((roi - lowerThreshold) / 0.1) * 0.3) / managedOrders['TRTL'].length;
  return 0;
}

function calculateSTLLimit(roi) {
  if (roi < lowerThreshold) return 0.01;
  // else if (roi < 2.4) return roi - 0.1;
  else if (roi < 2.4) return (0.5 + /*0.5 + */((roi - lowerThreshold) / 0.1) * 0.3) / managedOrders['STL'].length;
  return 0;
}

function calculateMSRLimit(roi) {
  if (roi < lowerThreshold) return 0.01;
  // else if (roi < 2.4) return roi - 0.1;
  else if (roi < 2.4) return (0.5 + /*0.5 + */((roi - lowerThreshold) / 0.1) * 0.3) / managedOrders['MSR'].length;
  return 0;
}

function pickSchedule(schedules, roi) {
  for (let i = 0; i < schedules.length; i++) {
    var schedule = schedules[i];
    if (roi > schedule.roi) return schedule;
  }
}
function nhRequest(request, args) {
  return nh[request](...args).catch(error => {
    console.error('nhRequest error', request, args, error);
  });
}

const difficultyEmitters = {
        'TRTL': new EventEmitter(),
        'ETN': new EventEmitter(),
        'STL': new EventEmitter(),
        'MSR': new EventEmitter()
      },
      cheapestEmitter = new EventEmitter();

runAndSchedule(checkTRTLDifficulty, 1 * 500);
runAndSchedule(checkEtnDifficulty, 1 * 500);
runAndSchedule(checkStlDifficulty, 4 * 500);
runAndSchedule(checkMSRDifficulty, 4 * 500);
// runAndSchedule(checkTRTLPrice, 30 * 1000);
runAndSchedule(checkTRTLPrice, 30 * 1000);
runAndSchedule(checkETNPrice, 30 * 1000);
runAndSchedule(checkSTLPrice, 30 * 1000);
runAndSchedule(checkMSRPrice, 90 * 1000);

function checkMSRDifficulty() {
  getMSRDifficulty()
    .then(([difficulty, height] : [number, number]) => {
      difficultiesErrorCount['MSR'] = 0;
      let timeSinceLast = new Date().getTime() - lastBlocks['MSR'];
      if (lastHeights['MSR'] !== height) {
        lastBlocks['MSR'] = new Date().getTime();
        lastHeights['MSR'] = height;
      }
      if (lastDifficulties['MSR'] !== difficulty) {
        const diff = difficulty - lastDifficulties['MSR'];
        const secondsSinceLast = (timeSinceLast / 1000).toFixed(1);
        if (diff > 0) {

          console.log(chalk.red(`^^^^^^^^ MSR ${renderBlockInfo(difficulty, lastDifficulties['MSR'], height, secondsSinceLast, timeSinceLast)} ^^^^^^^^`));
        }
        else if (diff < 0) {
          console.log(chalk.green(`vvvvvvvv MSR ${renderBlockInfo(difficulty, lastDifficulties['MSR'], height, secondsSinceLast, timeSinceLast)} vvvvvvvv`));
        }
        else {
          console.log(chalk.yellow(`======== MSR ${renderBlockInfo(difficulty, lastDifficulties['MSR'], height, secondsSinceLast, timeSinceLast)} ========`));
        }
        lastDifficulties['MSR'] = difficulty;
        difficultyEmitters['MSR'].emit('difficulty', difficulty);
      }
    })
    .catch(error => {
      difficultiesErrorCount['MSR']++;

      console.log('error getting difficulty', error);
    });
}

function getMSRDifficulty() {
  return new Promise((resolve, reject) => {
    msrDaemonGetInfo((error, response) => {
      if (error) return reject(error);
      resolve([response.difficulty, response.height]);
    });
  });
}

function checkEtnDifficulty() {
  getEtnDifficulty()
    .then(([difficulty, height] : [number, number]) => {
      difficultiesErrorCount['ETN'] = 0;
      let timeSinceLast = new Date().getTime() - lastBlocks['ETN'];
      if (lastHeights['ETN'] !== height) {
        lastBlocks['ETN'] = new Date().getTime();
        lastHeights['ETN'] = height;
      }
      if (lastDifficulties['ETN'] !== difficulty) {
        const diff = difficulty - lastDifficulties['ETN'];
        const secondsSinceLast = (timeSinceLast / 1000).toFixed(1);
        if (diff > 0) {

          console.log(chalk.red(`^^^^^^^^ ETN ${renderBlockInfo(difficulty, lastDifficulties['ETN'], height, secondsSinceLast, timeSinceLast)} ^^^^^^^^`));
        }
        else if (diff < 0) {
          console.log(chalk.green(`vvvvvvvv ETN ${renderBlockInfo(difficulty, lastDifficulties['ETN'], height, secondsSinceLast, timeSinceLast)} vvvvvvvv`));
        }
        else {
          console.log(chalk.yellow(`======== ETN ${renderBlockInfo(difficulty, lastDifficulties['ETN'], height, secondsSinceLast, timeSinceLast)} ========`));
        }
        lastDifficulties['ETN'] = difficulty;
        difficultyEmitters['ETN'].emit('difficulty', difficulty);
      }
    })
    .catch(error => {
      difficultiesErrorCount['ETN']++;

      // if (etnDifficultyErrorCount > 1) {
      //   slowAllOrders();
      // }
      console.log('error getting difficulty', error);
    });
}

function getEtnDifficulty() {
  return new Promise((resolve, reject) => {
    etnDaemonGetInfo((error, response) => {
      if (error) return reject(error);//return console.error('getinfo error', error);
      // console.log(response);
      resolve([response.difficulty, response.height]);
    });
  });
}

function checkStlDifficulty() {
  getStlDifficulty()
    .then(([difficulty, height] : [number, number]) => {
      difficultiesErrorCount['STL'] = 0;
      let timeSinceLast = new Date().getTime() - lastBlocks['STL'];
      if (lastHeights['STL'] !== height) {
        lastBlocks['STL'] = new Date().getTime();
        lastHeights['STL'] = height;
      }
      if (lastDifficulties['STL'] !== difficulty) {
        const diff = difficulty - lastDifficulties['STL'];
        const secondsSinceLast = (timeSinceLast / 1000).toFixed(1);
        if (diff > 0) {

          console.log(chalk.red(`^^^^^^^^ STL ${renderBlockInfo(difficulty, lastDifficulties['STL'], height, secondsSinceLast, timeSinceLast)} ^^^^^^^^`));
        }
        else if (diff < 0) {
          console.log(chalk.green(`vvvvvvvv STL ${renderBlockInfo(difficulty, lastDifficulties['STL'], height, secondsSinceLast, timeSinceLast)} vvvvvvvv`));
        }
        else {
          console.log(chalk.yellow(`======== STL ${renderBlockInfo(difficulty, lastDifficulties['STL'], height, secondsSinceLast, timeSinceLast)} ========`));
        }
        lastDifficulties['STL'] = difficulty;
        difficultyEmitters['STL'].emit('difficulty', difficulty);
      }
    })
    .catch(error => {
      difficultiesErrorCount['STL']++;

      // if (etnDifficultyErrorCount > 1) {
      //   slowAllOrders();
      // }
      console.log('error getting difficulty', error);
    });
}

function getStlDifficulty() {
  return new Promise((resolve, reject) => {
    stlDaemonGetInfo((error, response) => {
      if (error) return reject(error);//return console.error('getinfo error', error);
      // console.log(response);
      resolve([response.difficulty, response.height]);
    });
  });
}

difficultyEmitters['TRTL'].once('difficulty', () => {
  runAndSchedule(checkOrders, 10 * 1000);
  // runAndSchedule(projectDifficulty, 10 * 1000);

  runAndSchedule(() => updateOrdersStats(0, algo), 10 * 1000);
  runAndSchedule(() => updateOrdersStats(1, algo), 10 * 1000);

  getAndManageOrders(0, 22);
  getAndManageOrders(1, 22);
});

difficultyEmitters['TRTL'].on('difficulty', () => {
  printOrders(0, algo);
  printOrders(1, algo);
});


function checkTRTLDifficulty() {
  getDifficulty()
    .then(([difficulty, height] : [number, number]) => {
      difficultiesErrorCount['TRTL'] = 0;
      let timeSinceLast = new Date().getTime() - lastBlocks['TRTL'];
      if (lastHeights['TRTL'] !== height) {
        lastBlocks['TRTL'] = new Date().getTime();
        lastHeights['TRTL'] = height;
      }
      if (lastDifficulties['TRTL'] !== difficulty) {
        const diff = difficulty - lastDifficulties['TRTL'];
        const secondsSinceLast = (timeSinceLast / 1000).toFixed(1);
        if (diff > 0) {

          console.log(chalk.red(`^^^^^^^^ TRTL ${renderBlockInfo(difficulty, lastDifficulties['TRTL'], height, secondsSinceLast, timeSinceLast)} ^^^^^^^^`));
        }
        else if (diff < 0) {
          console.log(chalk.green(`vvvvvvvv TRTL ${renderBlockInfo(difficulty, lastDifficulties['TRTL'], height, secondsSinceLast, timeSinceLast)} vvvvvvvv`));
        }
        else {
          console.log(chalk.yellow(`======== TRTL ${renderBlockInfo(difficulty, lastDifficulties['TRTL'], height, secondsSinceLast, timeSinceLast)} ========`));
        }
        lastDifficulties['TRTL'] = difficulty;
        difficultyEmitters['TRTL'].emit('difficulty', difficulty);
      }
    })
    .catch(error => {
      difficultiesErrorCount['TRTL']++;

      if (difficultiesErrorCount['TRTL'] > 1) {
        slowAllOrders();
      }
      console.log('error getting difficulty', error);
    });
}

function renderBlockInfo(difficulty, lastDifficulty, height, secondsSinceLast, timeSinceLast) {
  return `Difficulty: ${difficulty} (${difficulty > lastDifficulty ? '+' : ''}${difficulty - lastDifficulty})(${difficulty > lastDifficulty ? '+' : ''}${((difficulty - lastDifficulty) / lastDifficulty * 100).toFixed(2)}%)| |${height} height| (${secondsSinceLast} s [${(timeSinceLast / (30 * 10)).toFixed(2)}%])`;
}

function renderBlockTime(time) {
}

function slowAllOrders() {
  console.log('************* SLOWING ALL ORDERS!', managedOrders['TRTL']);
  managedOrders['TRTL'].forEach(({order, location, algo}) => {
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


function checkTRTLPrice() { return checkTradeOgrePrice('TRTL').catch(error => console.error('Error fetching TRTL price', error)); }
function checkETNPrice() { return checkTradeOgrePrice('ETN').catch(error => console.error('Error fetching ETN price', error)); }
function checkSTLPrice() { return checkTradeOgrePrice('STL').catch(error => console.error('Error fetching STL price', error)); }
function checkMSRPrice() { return checkStocksExchangePrice('MSR').catch(error => console.error('Error fetching MSR price', error)); }

function checkCryptopiaPrice(symbol) {
  return new Promise((resolve, reject) => {
    fetchUrl(`https://www.cryptopia.co.nz/api/GetMarket/${symbol}_BTC`, (error, meta, body) => {
      if (error) return reject(error);

      const {Data:{BidPrice}} = JSON.parse(body.toString()),
            satoshis = stringToSatoshis(BidPrice);

      console.log(`${printCoin(symbol)} PRICE [cryptopia]:`, chalk.yellow(satoshis.toString()));
      exchangePrices['cryptopia'][symbol] = satoshis;
      return resolve(satoshis);
    });
  });
}

function checkStocksExchangePrice(symbol) {
  return new Promise((resolve, reject) => {
    fetchUrl(`https://stocks.exchange/api2/prices`, {headers:{'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.119 Safari/537.36'}}, (error, meta, body) => {
      if (error) return reject(error);

      try {
        const prices = JSON.parse(body.toString()),
              market = prices.find(({market_name}) => market_name === `${symbol}_BTC`),
              satoshis = stringToSatoshis(market.buy);

        console.log(`${printCoin(symbol)} PRICE [cryptopia]:`, chalk.yellow(satoshis.toString()));
        exchangePrices['stocks.exchange'][symbol] = satoshis;
        return resolve(satoshis);
      }
      catch (e) {return reject(e);}
    });
  });
}

function checkTradeOgrePrice(symbol) {
  return new Promise((resolve, reject) => {
    fetchUrl(`https://tradeogre.com/api/v1/orders/BTC-${symbol}`, (error, meta, body) => {
      if (error) return reject(error);
       // return console.error(`Error checking ${symbol} price`, error);

      const {buy} = JSON.parse(body.toString());

      const prices = Object.keys(buy).map(key => {
        const [f, s] = key.split('.'),
              satoshis = parseInt(f) * 100000000 + parseInt(s);
        return satoshis;
      });

      prices.sort().reverse();

      if (prices.length > 0) {
        console.log(`${printCoin(symbol)} PRICE [tradeogre]:`, chalk.yellow((prices[0] || 0).toString()));
        exchangePrices['tradeogre'][symbol] = prices[0] || 0;
        return resolve(prices[0]);
      }
      return resolve(0);
    });
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
      }

    });
  });
}

function stringToSatoshis(str) {
  const [big, little] = str.toString().split('.');
  return parseInt(little.padEnd(8, '0')) + parseInt(big) * 100000000
}

function getAndManageOrders(location, algo) {
  nh.getMyOrders(location, algo)
    .then(response => {
      const orders = response.body.result.orders;

      orders.forEach(order => {
        const {id, price, limit_speed, pool_user} = order;
        if (pool_user === 'TRTLv1W1So77yGbVtrgf8G4epg5Fhq9hEZvpZC8ev86xRVLYsQQMHrxQG92QVjUU3bcE6ThGw9vSbEHBMejJpexE2sdrTC24ZXR.600000') { // turtlecoin
          manageOrder(id, stringToSatoshis(price), Object.assign({}, config, {location, algo, limit: parseFloat(limit_speed)}), nh, calculateTurtleLimit, 'TRTL');
        }
        else if (pool_user === 'etnk1FzHAgEH2p15Usyzy5UhYocszGggwFaHE6k8Z1ZSBE4kww7azLkT3qgVFgKn5LaVxV9NRssPu5PsWLtJteZw9v6yhMEVRA.600000') { // electroneum
          manageOrder(id, stringToSatoshis(price), Object.assign({}, config, {location, algo, limit: parseFloat(limit_speed)}), nh, roi => roi > 0.15 ? 0.5 : 0.01, 'ETN');
          // , 'ETN'
        }
        else if (pool_user === 'Se31xtpSdztCAmrDVd8zmp7TCFtHm1LjrQx9zUgi6rByS6iQTP6T2FY1vhxcRMPURx9sYXTqTWCxuPE6aKbwHHhT1WYcsKDWy.600000' ||
                 pool_user === 'Se31xtpSdztCAmrDVd8zmp7TCFtHm1LjrQx9zUgi6rByS6iQTP6T2FY1vhxcRMPURx9sYXTqTWCxuPE6aKbwHHhT1WYcsKDWy') { // stellite
          manageOrder(id, stringToSatoshis(price), Object.assign({}, config, {location, algo, limit: parseFloat(limit_speed)}), nh, calculateSTLLimit, 'STL');
          // , 'STL'
        }
        else if (pool_user === '5iJjH9UH36SgL367R3F6WD638qQmeRyWrEXFnTKURLtZW196MdueJ6TJnJJN4PEnRhM6au2QYRLdmNoyta2Qwax71irJXuU.600000') { // masari
          manageOrder(id, stringToSatoshis(price), Object.assign({}, config, {location, algo, limit: parseFloat(limit_speed)}), nh, calculateMSRLimit, 'MSR');
        }
        // else console.log('Unknown pool_user', pool_user, order);
      });
    })
    .catch(error => console.error('ERROR getting and managing orders', location, algo, error));
}

function getCheapestFilledAtLimit(location, algo, limit) {
  const orders = latestOrders[location][algo];

  for (let i = orders.length - 1; i >= 0; i--) {
    const order = orders[i];

    if (parseFloat(order.accepted_speed) * 1000 >= limit && order.workers > 0) return order;
  }
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
        if (order.workers > 0 && parseFloat(order.price) < parseFloat(cheapestGreaterThan1MH.price) && parseFloat(order.accepted_speed) * 1000 > 0.05) {
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
        cheapestGreaterThan1MH = cheapestGreaterThan1MHAtLocation[location],
        price = stringToSatoshis(cheapestGreaterThan1MH.price) + 10000;

  const rois = ['TRTL', 'STL', 'ETN', 'MSR'].map(coin => `${printCoin(coin)}:${printROI(calculateROI(coin, lastDifficulties[coin], price))}`).join('|');

  const s = `[${printPrice(cheapestFilled.price)} (${(parseFloat(cheapestFilled.accepted_speed) * 1000).toFixed(2)} MH/s)|${printPrice(cheapestGreaterThan1MH.price)} (${(parseFloat(cheapestGreaterThan1MH.accepted_speed) * 1000).toFixed(2)} MH/s)] [${renderLocation(location)}] [ROI|${rois}] ${renderAlgo(algo)} [${orders.length} orders] (${total_speed.toFixed(2)} MH/s)`;

  if (s != summaryPrints[location][algo]) console.log(s);
  summaryPrints[location][algo] = s;
}

function checkOrders() {
  checkLocationOrders(0, algo);
  checkLocationOrders(1, algo);
}

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

function manageOrder(order, price, {threshold, roiThreshold, roiEndThreshold, limit, minimumMineTime, location, algo}, nh, calculateLimit, coin) {
  console.log('Now managing', order, 'on', renderLocation(location));
  let startTime;

  const orderData = {order, limit, location, algo, price, coin, settingPrice: false, settingLimit: false};

  // const throttledStart = throttle(startNiceHash, 500);

  managedOrders[coin].push(orderData);

  difficultyEmitters[coin].on('difficulty', difficulty => {
    checkROIWithDifficulty(difficulty, startNiceHash, slowNiceHash);
  });
  cheapestEmitter.on('updated', () => checkROIWithDifficulty(lastDifficulties[coin], startNiceHash, slowNiceHash));

  checkROIWithDifficulty(lastDifficulties[coin], startNiceHash, slowNiceHash);

  // runAndSchedule(checkAndRunROI, 4 * 1000);
  // setTimeout(() => runAndSchedule(priceReducer, (10 * 60 + 1) * 1000), 5000);

  function priceReducer() {
    const cheapest = cheapestGreaterThan1MHAtLocation[location];
    if (cheapest) {
      const cheapestPrice = stringToSatoshis(cheapest.price);
      if (orderData.price > (cheapestPrice + 20000)) {
        console.log('Reducing Price on', order, 'new price', price - 10000);
        nh.setOrderPrice({
          location,
          algo,
          order,
          price: (price - 10000) / 100000000
        })
          .then(response => {
            console.log('price reduction response', response.body.result);
            if (response.body.result.success) orderData.price = price - 10000;
          })
          .catch(error => {
            console.log('ERROR set order price reducer', error);
          });
      }
    }
  }

  function checkROIWithDifficulty(difficulty, start, stop) {
    const roi = calculateROI(coin, difficulty, orderData.price);
    start(difficulty, isNaN(roi) ? 0 : roi);
  }

  function startNiceHash(difficulty, roi) {
    startTime = new Date().getTime();

    const newLimit = calculateLimit(roi);

    if (newLimit !== orderData.limit && !orderData.settingLimit) {
      orderData.settingLimit = true;
      // console.log('starting', orderData.order, newLimit.toFixed(2));

      setOrderLimit(newLimit)
        .then(response => {
          orderData.settingLimit = false;
          if (response.body.result.success || response.body.result.error === 'This limit already set.') {
            orderData.limit = newLimit;
            console.log(chalk.red('new order limit set:', newLimit.toFixed(2)), chalk.green(order));
          }
        })
        .catch(error => {
          orderData.settingLimit = false;
          console.log('error setting order limit', error, limit);
        });
    }

    setTimeout(() => {
      // const price = parseFloat(cheapestGreaterThan1MHAtLocation[location].price) + 0.0002;
      const price = pricingStrategies[coin]({location, algo, newLimit, price: orderData.price});
      if (orderData.price < price && !orderData.settingPrice) {
        orderData.settingPrice = true;
        nh.setOrderPrice({location, algo, order, price})
          .then(response => {
            console.log(chalk.yellow('set order price response', JSON.stringify(response.body)));
            if (response.body.result.success) orderData.price = price;
            orderData.settingPrice = false;
          })
          .catch(error => {
            console.log('error setting price', error);
            orderData.settingPrice = false;
          });
      }
    }, Math.random() * 5 * 1000);
  }

  function slowNiceHash() {
    if (new Date().getTime() - startTime > minimumMineTime && orderData.limit !== 0.01) {
      console.log('slowing order');
      setOrderLimit(0.01)
        .then(response => {
          if (response.result.success) orderData.limit = 0.01;
          console.log('order limit response', response.body);
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

const networkRewards = {
  'TRTL': 29650,
  'ETN': 6795,
  'STL': 18535,
  'ITNS': 1475,
  'MSR': 27.7278
};

function calculateROI(coin, difficulty, niceHashBTCPrice) {
  const payout = (1000000 * 86400) / difficulty * networkRewards[coin],
        cost = niceHashBTCPrice / exchangePrices[currentExchange[coin]][coin],
        profit = payout - cost,
        roi = profit /cost;

  return roi;
}

function runAndSchedule(fn, interval) {
  setInterval(fn, interval);
  fn();
}

function updateOrdersStats(location, algo) {
  return nhRequest('getMyOrders', [location, algo])
    .then(response => {
      const {orders} = response.body.result;

      orders.forEach(order => {
        order.location = location;
        order.coin = getCoin(order.pool_user);
        ordersDB[order.coin || 'unknown'][location][algo][order.id] = Object.assign(ordersDB[order.coin][order.id] || {}, order);
        // if (!order.alive) {
        //   for (let i = managedOrders.length - 1; i >= 0; i--) {
        //     if (managedOrders[i].id === order.id) managedOrders.splice(i, 1);
        //   }
        // }
      });
      printOrders(location, algo);
    })
    .catch(error => console.log('Error updating order stats', error));
}

function getCoin(pool_user) {
  switch (pool_user) {
    case 'TRTLv1W1So77yGbVtrgf8G4epg5Fhq9hEZvpZC8ev86xRVLYsQQMHrxQG92QVjUU3bcE6ThGw9vSbEHBMejJpexE2sdrTC24ZXR.600000': return 'TRTL';
    case 'etnk1FzHAgEH2p15Usyzy5UhYocszGggwFaHE6k8Z1ZSBE4kww7azLkT3qgVFgKn5LaVxV9NRssPu5PsWLtJteZw9v6yhMEVRA.600000': return 'ETN';
    case 'Se31xtpSdztCAmrDVd8zmp7TCFtHm1LjrQx9zUgi6rByS6iQTP6T2FY1vhxcRMPURx9sYXTqTWCxuPE6aKbwHHhT1WYcsKDWy':
    case 'Se31xtpSdztCAmrDVd8zmp7TCFtHm1LjrQx9zUgi6rByS6iQTP6T2FY1vhxcRMPURx9sYXTqTWCxuPE6aKbwHHhT1WYcsKDWy.600000': return 'STL';
    case 'dERoMN3xY15U2hL8yJeHPGQN2YaRWSTmcdvFEC9rjQUz1qDFnxTk7xeJVQkRkbfR5cNFPSNynviNsPXRxHELvfo28tXuUfwRBZ.600000': return 'DER';
    case '5iJjH9UH36SgL367R3F6WD638qQmeRyWrEXFnTKURLtZW196MdueJ6TJnJJN4PEnRhM6au2QYRLdmNoyta2Qwax71irJXuU.600000': return 'MSR';
    case 'iz44v9Cs9XtPAXqdTwAbQPBMNqQWhY1ns77imdefBk641UfEsVN8zLqAFjrtHbaMv1TygTcvJWzGN3zNR6PeEYuc1w8UuQafE.745d0a1a35ba0813fb28d39585698613a31ee26d0921621f40797823f18f2adf+600000': return 'ITNS';
  }
  return 'unknown';
}

let lastBTCAvail = 0;

function printOrders(location, algo) {
  Object.values(ordersDB).forEach(coinDB => coinDB[location][algo].forEach(printOrder));

  let btc_avail = 0, orders = 0, avails = [];
  Object
    .values(ordersDB)
    .forEach(coinDB =>
      Object
        .values(coinDB)
        .forEach(location =>
          Object
            .values(location)
            .forEach(algo =>
              Object
                .values(algo)
                .forEach(order => {
                  const [big, little] = order['btc_avail'].split('.');
                  btc_avail += parseInt(little.padEnd(8, '0')) + parseInt(big) * 100000000;
                  avails.push([parseInt(big), parseInt(little.padEnd(8, '0'))]);
                  orders++;
                }))));

    if (lastBTCAvail !== btc_avail) console.log('BTC AVAIL:', btc_avail / 100000000, 'from', orders, 'orders');
    lastBTCAvail = btc_avail;
}

const lastPrints = {
  '0': {
    '22': {}
  },
  '1': {
    '22': {}
  }
};

function printOrder({id, coin, algo, btc_avail, limit_speed, price, end, workers, btc_paid, location, accepted_speed}) {
  const avail = parseFloat(btc_avail),
        paid = parseFloat(btc_paid),
        roi = calculateROI(coin, lastDifficulties[coin], stringToSatoshis(price)),
        limitCostPerHour = limit_speed * price / 24,
        limitProfitPerHour = limitCostPerHour * (1 + roi) - limitCostPerHour,
        acceptedCostPerHour = (parseFloat(accepted_speed) * 1000) * price / 24,
        acceptedProfitPerHour = acceptedCostPerHour * (1 + roi) - acceptedCostPerHour,
        {workersAbove, workersBelow} = separateWorkersOnOrder(id, location, algo, price),
        marketPosition = workersBelow / (workersAbove + workersBelow),
        cheapestPriceAtLimit = (getCheapestFilledAtLimit(location, algo, limit_speed) || {}).price,
        s = `[${printROI(roi)} ROI](${printCoin(coin)})[${printPrice(`B ${price}`)}|${printPrice(`B ${cheapestPriceAtLimit}`)}|${((price - cheapestPriceAtLimit) / cheapestPriceAtLimit * 100).toFixed(1)}%][${printLimit(limit_speed)} limit <B${printRate(limitProfitPerHour)}/hr>][${printSpeed((parseFloat(accepted_speed) * 1000))} MH/s <B${printRate(acceptedProfitPerHour)}/hr>][${workers} w (${(marketPosition * 100).toFixed(1)}%)][${renderProgress(1 - (avail / (avail + paid)))}] [${avail.toFixed(5)} avail] ${renderLocation(location)} ${id}`;

  if (s != lastPrints[location][algo][id]) console.log(s);

  lastPrints[location][algo][id] = s;
}

function printROI(roi) {
  const format = roi.toFixed(3);
  if (roi > 0.3) return chalk.green(format);
  else if (roi < 0) return chalk.red(format);
  return chalk.yellow(format);
}

function printCoin(coin) {
  switch (coin) {
    case 'TRTL': return chalk.green(coin);
    case 'ETN': return chalk.blue(coin);
    case 'STL': return chalk.magenta(coin);
    case 'DER': return chalk.cyan(coin);
    case 'MSR': return chalk.red(coin);
    case 'ITNS': return chalk.yellow(coin);
    case 'BTC': return chalk.yellow(coin);
  }
  return coin;
}
function printPrice(price) { return chalk.yellow(price); }
function printRate(rate) { return chalk[rate < 0 ? 'red' : 'green'](rate.toFixed(4)); }
function printSpeed(speed) { return chalk[speed > 0.01 ? 'blue' : 'grey'](speed.toFixed(2))}


function printLimit(limit) {
  return limit > 0.01 ? chalk.green(limit) : chalk.grey(limit);
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

  if (progress > 0.75) return chalk.red(ret);
  else if (progress > 0.45) return chalk.yellow(ret);
  return chalk.green(ret);

  // return ret;
}

// https://github.com/uxitten/polyfill/blob/master/string.polyfill.js
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/padStart
if (!String.prototype.padStart) {
    String.prototype.padStart = function padStart(targetLength,padString) {
        targetLength = targetLength>>0; //truncate if number or convert non-number to 0;
        padString = String((typeof padString !== 'undefined' ? padString : ' '));
        if (this.length > targetLength) {
            return String(this);
        }
        else {
            targetLength = targetLength-this.length;
            if (targetLength > padString.length) {
                padString += padString.repeat(targetLength/padString.length); //append to original to ensure we are longer than needed
            }
            return padString.slice(0,targetLength) + String(this);
        }
    };
}

// https://github.com/uxitten/polyfill/blob/master/string.polyfill.js
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/padEnd
if (!String.prototype.padEnd) {
    String.prototype.padEnd = function padEnd(targetLength,padString) {
        targetLength = targetLength>>0; //floor if number or convert non-number to 0;
        padString = String((typeof padString !== 'undefined' ? padString : ' '));
        if (this.length > targetLength) {
            return String(this);
        }
        else {
            targetLength = targetLength-this.length;
            if (targetLength > padString.length) {
                padString += padString.repeat(targetLength/padString.length); //append to original to ensure we are longer than needed
            }
            return String(this) + padString.slice(0,targetLength);
        }
    };
}