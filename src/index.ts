import {spawn} from 'child_process';
import * as querystring from 'querystring';
import * as EventEmitter from 'events';
import * as https from 'https';

import * as nicehash from 'nicehash';

import chalk from 'chalk';

import {fetchUrl} from 'fetch';

import {createAPI} from './apiInterfaces';
import {start} from './server';

const broadcast = start();

const apiId = process.env['API_ID'],
      apiKey = process.env['API_KEY'],
      TO_PUBLIC = process.env['TO_PUBLIC'],
      TO_PRIVATE = process.env['TO_PRIVATE'];

const nh = new nicehash({apiId, apiKey});

const {rpcWallet: trtlWallet, rpcDaemon, daemonGetInfo} = createAPI({host: '127.0.0.1', port: 11898}, {host: '127.0.0.1', port: 9999});
const {rpcWallet: masterCollectorWallet} = createAPI({host: '127.0.0.1', port: 11898}, {host: '127.0.0.1', port: 9998});
const {rpcWallet: xtlWallet, rpcDaemon: xtlDaemon, daemonGetInfo: xtlDaemonGetInfo} = createAPI({host: '127.0.0.1', port: 7777}, {host: '127.0.0.1', port: 7779});
const {rpcWallet: etnWallet, rpcDaemon: etnDaemon, daemonGetInfo: etnDaemonGetInfo} = createAPI({host: '127.0.0.1', port: 8888}, {host: '127.0.0.1', port: 8889});
const {rpcWallet: msrWallet, rpcDaemon: msrDaemon, daemonGetInfo: msrDaemonGetInfo} = createAPI({host: '127.0.0.1', port: 9988}, {host: '127.0.0.1', port: 9989});
const {rpcWallet: itnsWallet, rpcDaemon: itnsDaemon, daemonGetInfo: itnsDaemonGetInfo} = createAPI({host: '127.0.0.1', port: 9978}, {host: '127.0.0.1', port: 9979});
const {rpcWallet: grftWallet, rpcDaemon: grftDaemon, daemonGetInfo: grftDaemonGetInfo} = createAPI({host: '127.0.0.1', port: 9968}, {host: '127.0.0.1', port: 9969});


const ordersDB = ['TRTL', 'ETN', 'XTL', 'DER', 'MSR', 'ITNS', 'GRFT', 'unknown'].reduce((db, coin) => (db[coin] = {'0': {22: {}}, '1': {22: {}}}, db), {});

const pools = {
  'TRTL': [
    '165.227.80.178',
    '159.65.77.77',
    '159.65.63.178',
    '207.154.195.78',
    '188.166.26.62',
    '165.227.43.9'
  ]
};

const poolStatus = {
  '165.227.80.178': undefined,
  '159.65.77.77': undefined,
  '159.65.63.178': undefined,
  '207.154.195.78': undefined,
  '188.166.26.62': undefined,
  '165.227.43.9': undefined
};

const networkRewards = {
  'TRTL': 29650,
  'ETN': 6795,
  'XTL': 18535,
  'ITNS': 1450,
  'MSR': 27.24,
  'GRFT': 1781.52
};

const limitFn = {
  'TRTL': calculateTRTLLimit,
  'ETN': calculateETNLimit,
  'XTL': calculateXTLLimit,
  'MSR': calculateMSRLimit,
  'ITNS': calculateITNSLimit,
  'GRFT': calculateGRFTLimit
};

const lowerThreshold = 0.2;
function calculateTRTLLimit(roi) {
  if (roi < lowerThreshold) return 0.01;
  else if (roi < 1.5) return (1 + /*0.5 + */((roi - lowerThreshold) / 0.1) * 0.3) / managedOrders['TRTL'].length;
  return 0;
}

const xtlLowerThreshold = 0.2;
function calculateXTLLimit(roi) {
  if (roi < xtlLowerThreshold) return 0.01;
  // else if (roi < 2.4) return roi - 0.1;
  else if (roi < 1) return (1 + /*0.5 + */((roi - lowerThreshold) / 0.1) * 1) / managedOrders['XTL'].length;
  return 5;
}

const etnLowerThreshold = 0.2;
function calculateETNLimit(roi) {
  if (roi < etnLowerThreshold) return 0.01;
  // else if (roi < 2.4) return roi - 0.1;
  else if (roi < 2.4) return (12 + /*0.5 + */((roi - etnLowerThreshold) / 0.1) * 3) / managedOrders['ETN'].filter(({coin, location, algo, order}) => ordersDB[coin][location][algo][order].workers > 0).length;
  return 0;
}

const msrLowerThreshold = 0.2;
function calculateMSRLimit(roi) {
  if (roi < msrLowerThreshold) return 0.01;
  // else if (roi < 2.4) return roi - 0.1;
  else if (roi < 2.4) return (0.5 + /*0.5 + */((roi - msrLowerThreshold) / 0.1) * 0.35) / managedOrders['MSR'].length;
  return 0;
}

const itnsLowerThreshold = 0.2;
function calculateITNSLimit(roi) {
  if (roi < itnsLowerThreshold) return 0.01;
  // else if (roi < 2.4) return roi - 0.1;
  else if (roi < 2.4) return (1 + /*0.5 + */((roi - itnsLowerThreshold) / 0.1) * 3) / managedOrders['ITNS'].length;
  return 0;
}

const grftLowerThreshold = 0.2;
function calculateGRFTLimit(roi) {
  if (roi < grftLowerThreshold) return 0.01;
  // else if (roi < 2.4) return roi - 0.1;
  else if (roi < 2.4) return (10 + /*0.5 + */((roi - grftLowerThreshold) / 0.1) * 3) / managedOrders['ITNS'].length;
  return 0;
}

const poolStopFn = {
  'TRTL': ({roi}) => roi < -0.1,
  'ETN': ({roi}) => false,
  'XTL': ({roi}) => false,
  'MSR': ({roi}) => false,
  'ITNS': ({roi}) => false,
  'GRFT': ({roi}) => false
};

const poolStartFn = {
  'TRTL': ({roi}) => roi > -0.1,
  'ETN': ({roi}) => false,
  'XTL': ({roi}) => false,
  'MSR': ({roi}) => false,
  'ITNS': ({roi}) => false,
  'GRFT': ({roi}) => false
};

const difficultiesErrorCount = {
  'TRTL': 0,
  'ETN': 0,
  'XTL': 0,
  'DER': 0,
  'MSR': 0,
  'ITNS': 0,
  'GRFT': 0
};

const lastDifficulties = {
  'TRTL': undefined,
  'ETN': undefined,
  'XTL': undefined,
  'DER': undefined,
  'MSR': undefined,
  'ITNS': undefined,
  'GRFT': undefined
};

const lastBlocks = {
  'TRTL': 0,
  'ETN': 0,
  'XTL': 0,
  'DER': 0,
  'MSR': 0,
  'ITNS': 0,
  'GRFT': 0
};

const lastHeights = {
  'TRTL': 0,
  'ETN': 0,
  'XTL': 0,
  'DER': 0,
  'MSR': 0,
  'ITNS': 0,
  'GRFT': 0
};

const currentExchange = {
  'TRTL': 'tradeogre',
  'ETN': 'tradeogre',
  'XTL': 'tradeogre',
  'DER': 'cryptopia',
  'MSR': 'stocks.exchange',
  'ITNS': 'stocks.exchange',
  'GRFT': 'tradeogre'
};

const pricingStrategies = {
  'TRTL': ({location, algo, newLimit, workers}) => (stringToSatoshis((getPriceForLimit(location, algo, newLimit, workers) || {price: 0}).price) + 20000),
  'ETN': ({price}) => price,
  // 'ETN': ({location, algo, newLimit, workers}) => (stringToSatoshis((getPriceForLimit(location, algo, newLimit, workers) || {price: 0}).price) + 20000),
  'XTL': ({price}) => price,
    // 'XTL': ({location, algo, newLimit, workers}) => (stringToSatoshis((getPriceForLimit(location, algo, newLimit, workers) || {price: 0}).price) + 20000),
  'DER': ({price}) => price,
  // 'MSR': ({price}) => price,
  'MSR': ({location, algo, newLimit, workers}) => (stringToSatoshis((getPriceForLimit(location, algo, newLimit, workers) || {price: 0}).price) + 20000),
  'ITNS': ({location, algo, newLimit, workers}) => (stringToSatoshis((getPriceForLimit(location, algo, newLimit, workers) || {price: 0}).price) + 20000),
  // 'ITNS': ({price}) => price,
  'GRFT': ({price}) => price
};



const exchanges = {
  'tradeogre': {coins: ['TRTL', 'ETN', 'XTL', 'GRFT', 'BTC']},
  'stocks.exchange': {coins: ['MSR', 'ITNS']},
  'cryptopia': {coins: [/*'ETN'*/]},
  'tradesatoshi': {coins: ['TRTL']}
};

const exchangePrices = {
  'tradeogre': {},
  'cryptopia': {},
  'stocks.exchange': {'MSR':1550,'ITNS':55},
  'tradesatoshi': {}
};

const coinStatus = {
  'TRTL': {selling: true},
  'ETN': {selling: true},
  'XTL': {selling: true},
  'DER': {selling: false},
  'MSR': {selling: false},
  'ITNS': {selling: false},
  'GRFT': {selling: true},
  'BTC': {selling: false}
};

const walletBalances = {
  'TRTL': {},
  'ETN': {},
  'XTL': {},
  'DER': {},
  'ITNS': {},
  'GRFT': {},
  'BTC': {},
  'nicehash': {}
};

const managedOrders = {'TRTL': [], 'ETN': [], 'XTL': [], 'ITNS': [], 'DER': [], 'MSR': [], 'GRFT': []};


const latestOrders = {
  '0': {
    22: []
  },
  '1': {
    22: []
  }
};

const latestLocationInfo = {
  '0': {22:{}},
  '1': {22:{}}
};

const algo = 22;

const difficultyEmitters = {
        'TRTL': new EventEmitter(),
        'ETN': new EventEmitter(),
        'XTL': new EventEmitter(),
        'MSR': new EventEmitter(),
        'ITNS': new EventEmitter(),
        'GRFT': new EventEmitter()
      },
      cheapestEmitter = new EventEmitter();


const getDifficulty = daemonGetInfo => {
  return new Promise((resolve, reject) => {
    daemonGetInfo((error, response) => {
      if (error) return reject(error);
      resolve([response.difficulty, response.height]);
    });
  });
};

const checkDifficulty = (getDifficulty, coin) => {
  getDifficulty()
    .then(([difficulty, height] : [number, number]) => {
      difficultiesErrorCount[coin] = 0;
      let timeSinceLast = new Date().getTime() - lastBlocks[coin];
      if (lastHeights[coin] !== height) {
        lastBlocks[coin] = new Date().getTime();
        lastHeights[coin] = height;
      }
      if (lastDifficulties[coin] !== difficulty) {
        const diff = difficulty - lastDifficulties[coin];
        const secondsSinceLast = (timeSinceLast / 1000).toFixed(1);
        if (diff > 0) {

          console.log(chalk.red(`^^^^^^^^ ${printCoin(coin)} ${renderBlockInfo(difficulty, lastDifficulties[coin], height, secondsSinceLast, timeSinceLast)} ^^^^^^^^`));
        }
        else if (diff < 0) {
          console.log(chalk.green(`vvvvvvvv ${printCoin(coin)} ${renderBlockInfo(difficulty, lastDifficulties[coin], height, secondsSinceLast, timeSinceLast)} vvvvvvvv`));
        }
        else {
          console.log(chalk.yellow(`======== ${printCoin(coin)} ${renderBlockInfo(difficulty, lastDifficulties[coin], height, secondsSinceLast, timeSinceLast)} ========`));
        }
        lastDifficulties[coin] = difficulty;
        difficultyEmitters[coin].emit('difficulty', difficulty);
      }
    })
    .catch(error => {
      difficultiesErrorCount[coin]++;

      console.log('error getting difficulty', error);
    });
};

const checkITNSDifficulty = () => checkDifficulty(() => getDifficulty(itnsDaemonGetInfo), 'ITNS');
const checkGRFTDifficulty = () => checkDifficulty(() => getDifficulty(grftDaemonGetInfo), 'GRFT');

runAndSchedule(checkTRTLDifficulty, 1 * 500);
runAndSchedule(checkEtnDifficulty, 1 * 500);
// runAndSchedule(checkXTLDifficulty, 2 * 500);
runAndSchedule(checkMSRDifficulty, 2 * 500);
runAndSchedule(checkITNSDifficulty, 2 * 500);
runAndSchedule(checkGRFTDifficulty, 2 * 500);
// runAndSchedule(checkTRTLPrice, 30 * 1000);
runAndSchedule(checkTRTLPrice, 30 * 1000);
runAndSchedule(checkTRTLTradeSatoshiPrice, 30 * 1000);
runAndSchedule(checkETNPrice, 30 * 1000);
runAndSchedule(checkGRFTPrice, 30 * 1000);
// runAndSchedule(checkETNCryptopiaPrice, 30 * 1000);
runAndSchedule(checkXTLPrice, 30 * 1000);
runAndSchedule(checkMSRPrice, 30 * 1000);
runAndSchedule(checkITNSPrice, 30 * 1000);


function checkTRTLPrice() { return checkTradeOgrePrice('TRTL').catch(error => console.error('Error fetching TRTL price', error)); }
function checkTRTLTradeSatoshiPrice() { return checkTradeSatoshiPrice('TRTL').catch(error => console.error('Error fetching TRTL tradesatoshi price', error)); }
function checkETNPrice() { return checkTradeOgrePrice('ETN').catch(error => console.error('Error fetching ETN price', error)); }
function checkETNCryptopiaPrice() { return checkCryptopiaPrice('ETN').catch(error => console.error('Error fetching ETN price', error)); }
function checkGRFTPrice() { return checkTradeOgrePrice('GRFT').catch(error => console.error('Error fetching GRFT price', error)); }
function checkXTLPrice() { return checkTradeOgrePrice('XTL').catch(error => console.error('Error fetching XTL price', error)); }
function checkMSRPrice() { return checkStocksExchangePrice('MSR').catch(error => console.error('Error fetching MSR price', error)); }
function checkITNSPrice() { return checkStocksExchangePrice('ITNS').catch(error => console.error('Error fetching ITNS price', error)); }

setTimeout(() => {
  // runAndSchedule(transferWalletToTradeOgre, 60 * 1000);
  runAndSchedule(transferTRTLWallet, 60 * 1000);
  // runAndSchedule(transferWalletToTradeSatoshi, 60 * 1000);
  runAndSchedule(transferStelliteWalletToTradeOgre, 60 * 1000);
  // runAndSchedule(transferEtnWalletToTradeOgre, 60 * 1000);
  // runAndSchedule(transferEtnWalletToCryptopia, 60 * 1000);
  // runAndSchedule(transferMsrWalletToStocksExchange, 60 * 1000);
  // runAndSchedule(transferEtnWallet, 60 * 1000);
}, 5 * 1000);

function transferEtnWallet() {
  const exchange = getBestExchange('ETN');

  if (exchange === 'tradeogre') transferEtnWalletToTradeOgre();
  else if (exchange === 'cryptopia') transferEtnWalletToCryptopia();
}

function transferTRTLWallet() {
  const exchange = getBestExchange('TRTL');

  if (exchange === 'tradeogre') transferWalletToTradeOgre();
  else if (exchange === 'tradesatoshi') transferWalletToTradeSatoshi();
}

// setTimeout(() => runAndSchedule(transferWalletToTradeSatoshi, 60 * 1000), 30 * 1000);
// runAndSchedule(transferToCollectors, 0.2 * 1000);

runAndSchedule(checkNiceHashBalance, 60 * 1000);

runAndSchedule(checkTradeOgreBalances, 30 * 1000);

// const checkWalletBalance = {
//   'TRTL': () =>
// };

function checkTradeOgreBalances() {
  console.log('checking tradeogre balances');
  exchanges['tradeogre'].coins.forEach(coin => {
    getTradeOgreBalance(coin)
      .then(({balance, available}) => {
        console.log(`${chalk.blue('tradeogre')} ${printCoin(coin)} balance ${balance}, available ${parseFloat(available) > 0 ? chalk.yellow(available) : available}`);

        if (coinStatus[coin].selling) {

          const higher = parseFloat(available) * 0.2,
                basePrice = exchangePrices['tradeogre'][coin],
                higherPrice = basePrice + 1;

          let lower = parseFloat(available);

          if (higher * higherPrice >= 10000) {
            lower -= higher + 1;
            submitTradeOgreSellOrder(`BTC-${coin}`, higher, `0.${higherPrice.toString().padStart(8, '0')}`)
              .then(response => console.log(`tradeogre sell result ${coin} ${JSON.stringify(response)}`))
              .catch(error => console.error(`error selling ${higher} ${coin} on tradeogre`, error))
          }

          if (lower * basePrice >= 10000) {
            submitTradeOgreSellOrder(`BTC-${coin}`, lower, `0.${basePrice.toString().padStart(8, '0')}`)
              .then(response => console.log(`tradeogre sell result ${coin} ${JSON.stringify(response)}`))
              .catch(error => console.error(`error selling ${lower} ${coin} on tradeogre`, error))
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

      Object.assign(walletBalances['nicehash'], {confirmed, pending, total: total / 100000000});

      printInfo();
    })
    .catch(error => console.error('Error checking NiceHash balance', error));
}

const collectors = [
  'TRTLuzY1W6AGuipo3BhwnsNYCqkoKWjyuY3hnTq9Hfd2UKxbxGN91VyYqimiRpXFSCRTqdegtzhQSDvGw39haM1z4dU37CYEPhg',
  'TRTLuxkGc2j7uK6gMf5nQfJmYHjV9qYSDABWLyKxU5CxBpStu9TMiuR5KWv3M7LpHPGsH5aTJ6XdPMm5tx8QZ5imGNRfujxgFnE',
  'TRTLuwZ4PypMJigLkvtbHCV5knrB84ruXUC7i7AgUGr2AG8FdPncq1U2H7Ea4rjBiBjfF3ZifFU77GHVoD6RR3FjDUcB9Du4yLu',
  'TRTLv41KBQ9PL6EAzBpPiLSpQaRKioASPTqU3JqWpXWCWmHQ2SMvcLicDZikKBiWbWRonsCmirghDjEbNXB7yHxcMVcwBHgntwU',
  'TRTLv21Ee4fWdLpbuWGHbkZWFBC6ZdQTkdzKJnFgM4VvJCUS9pDn5m9cMMpvEHWKRnKtvfMWLoxB4K3knz9xiCC14KfsCdeg3TV',
  'TRTLv2JAh7pRawXrHCBgqwLo2DakTDm2cd6zVCvio2aTLLDzGbzNKzw8qnck8UkABkdPtnmxGfgEn5PUpRTa2xtL9tXQKwz6mPs',
  'TRTLv2MysAQENnsr9XgoS6LoBexeo3PLfhQpqz95kUaBMrLgmQxtfDwCNg33UYpZix5wrFwFXsUwCgUsvyNfv2ZVVrRRtCkwcGQ',
  'TRTLuzMHUy9JmovWYpieLZFF6qazpeNi7fVtnStazLFWLUpG9ztecPk2n3yWHfGsc2FWJzPQWrvKLWVZ6V1dowo7DH6i52Drm1c',
  'TRTLuxm6NTVG8UiR8zCFPq7iXNy7N7v9RT6bPf8v4mhu5peF9c82PyvDoaHbNPujDYhFgJmPrt3JZDGww5SDMghUbPFkm64sLDG',
  'TRTLuxTZKmu4jUqHxuMVeVCNqfEkjquB77Q25G1vihmagyRGjCb84D5D7WoG88XagZj7HaYKuzmKSWpLnbKNoSxb1tCmSdmrRne',
  'TRTLuwtG9Y6BD7wpEGHTHnFP2DpjXDYkgTm3vX64LHfdHjqnaGH4fDcgdi6mw8i4M2KKQrm1Nnkac5qE2zajyQSV5rVczNfkDkS',
  'TRTLuytMZGveJRm9dN5mqshykbBBJDT4XQ12kE9VjjdcesxWerT4p4KeRyceB9SxNSgC9gqStdeoGM23itVPu7sb6CPUxXn7zxE',
  'TRTLv1zZ7xahZbgW9965VFafm8oXktQEyXqBNGccZQE4e82ttvy5wEbQ5s9H8YjNXmjYpNFcqShbB53ouvQAsn5YCD5nyre9rWr',
  'TRTLv1CA5GX9b3YLo3qecwThcPJJrRGbm9UJFLnp9oWdZZJ1AwtGAdj9wjSL4v5LMhKZpXp5GmZPFXfKHv8JZ7mb4FmL5gqCFE2',
  'TRTLv3wysjMcWdRLeVfkFkds4aok7tu8hTJcLTxG329odhRvpT9s12hYRn57uLnbwpPDvvDjAdVvacYZXEftus2d24bjzQPmHHT',
  'TRTLuwsG6ufGDxy4v6MnRUcVcutNoDxk96AUb2c4qj2yTBWxsmLvQCqKzTAZw6K2bMUz743ATh1NNPRrMmAJfWs7LLUpN6ffnJC',
  'TRTLv1SoiesCHjpwMD8XfVPTVEhYyT3KNMYtdsUf7pJPNUnj8Hz5HmejbVDJCSvHyqFMGwnexZYWwfccB3zhsscs8GF5r638itL',
  'TRTLuy2C3BEC2sHQTU2Z6VRnEbPhP4HrN9jPRD5yRkvv9uY4NtU6oZFNZVn43XQjqgPQBEp9S5CdTWDiETkHe2gKMTb1PGYS78v',
  'TRTLv3sWLocR7PZyyZzduv9mBZrSB8hNGahnesP1eEbPFsZ1CZKfRhnZW8K3nPixwnj9tB4XLZKurYasTqFkpmGCBAmrkPDBiRq',
  'TRTLuxnuG5GZZpZkPL97vD1Wkke1BrY7uermRfKA3efndoV2n7opMtFbNn17BN55sBjnhFR6kxDRmBFWu65AuxNuPqkptXer2vY'
];

const collectorAmount = 1;


function transferStelliteWalletToTradeOgre() {
  const wallet = xtlWallet;

  wallet('getbalance', {}, (error, response) => {
    if (error) return console.error('error getting stellite balance', error);

    const {balance, unlocked_balance} = response;

    Object.assign(walletBalances['XTL'], {balance, unlocked_balance});

    // console.log(`${chalk.green('$$$$$$$$$$$$')} ${printCoin('XTL')} Wallet Balance: ${(unlocked_balance/100).toFixed(2)} available ||| ${chalk.green((balance / 100).toFixed(2))} total ${chalk.green('$$$$$$$$$$$$')}`);

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
      wallet('sweep_all', {
        'address': 'SEiStP7SMy1bvjkWc9dd1t2v1Et5q2DrmaqLqFTQQ9H7JKdZuATcPHUbUL3bRjxzxTDYitHsAPqF8EeCLw3bW8ARe8rYeorMw6p7nhasUgZ6S',
        'mixin': 1,
        'priority': 3,
        'unlock_time': 0
      }, (error, response) => {
        if (error) return console.error('error sweeping stellite wallet', error, response);

        if (response.tx_hash_list) console.log('swept stellite wallet', 'tx ids', response.tx_hash_list);
      });
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
    if (error) return console.error('error sweeping etn wallet', error, response);

    if (response) console.log('swept etn wallet', 'tx ids', response.tx_hash_list);
  });
}

function transferMsrWalletToStocksExchange() {
  const wallet = msrWallet;

  wallet('sweep_all', {
    'address': '5pc8m5HPJtEH8kuVH8eGgnSSuqYQXaPpTHYtxpbymrADCAXYt8xExSM55hi7bHvuCrYSDCYpM2XQkYTvoVupvqi6ASsX3AN',
    'payment_id': '6327c308515b691b232d67994f982275673a087f6b16769e3196334f3a71cc3f',
    'mixin': 1,
    'unlock_time': 0
  }, (error, response) => {
    if (error) return console.error('error sweeping msr wallet', error, response);

    if (response) console.log('swept msr wallet', 'tx ids', response.tx_hash_list);
  });
}

function transferWalletToTradeOgre() {
  const wallet = trtlWallet;
  trtlWallet('getbalance', {'address': 'TRTLv1W1So77yGbVtrgf8G4epg5Fhq9hEZvpZC8ev86xRVLYsQQMHrxQG92QVjUU3bcE6ThGw9vSbEHBMejJpexE2sdrTC24ZXR'}, (error, response) => {
    if (error) return console.error('error getting balance', error);

    const {available_balance, locked_amount} = response;

    Object.assign(walletBalances['TRTL'], {available_balance, locked_amount});

    // console.log(`${chalk.green('$$$$$$$$$$$$')} Wallet Balance: ${(available_balance/100).toFixed(2)} available, ${(locked_amount/100).toFixed(2)} locked ||| ${chalk.green(((available_balance + locked_amount) / 100).toFixed(2))} total ${chalk.green('$$$$$$$$$$$$')}`);

    if (available_balance/100 >  100) {
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

    Object.assign(walletBalances['TRTL'], {available_balance, locked_amount});

    // console.log(`${chalk.green('$$$$$$$$$$$$')} Wallet Balance: ${(available_balance/100).toFixed(2)} available, ${(locked_amount/100).toFixed(2)} locked ||| ${chalk.green(((available_balance + locked_amount) / 100).toFixed(2))} total ${chalk.green('$$$$$$$$$$$$')}`);

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

          console.log(chalk.red(`^^^^^^^^ ${printCoin('MSR')} ${renderBlockInfo(difficulty, lastDifficulties['MSR'], height, secondsSinceLast, timeSinceLast)} ^^^^^^^^`));
        }
        else if (diff < 0) {
          console.log(chalk.green(`vvvvvvvv ${printCoin('MSR')} ${renderBlockInfo(difficulty, lastDifficulties['MSR'], height, secondsSinceLast, timeSinceLast)} vvvvvvvv`));
        }
        else {
          console.log(chalk.yellow(`======== ${printCoin('MSR')} ${renderBlockInfo(difficulty, lastDifficulties['MSR'], height, secondsSinceLast, timeSinceLast)} ========`));
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

          console.log(chalk.red(`^^^^^^^^ ${printCoin('ETN')} ${renderBlockInfo(difficulty, lastDifficulties['ETN'], height, secondsSinceLast, timeSinceLast)} ^^^^^^^^`));
        }
        else if (diff < 0) {
          console.log(chalk.green(`vvvvvvvv ${printCoin('ETN')} ${renderBlockInfo(difficulty, lastDifficulties['ETN'], height, secondsSinceLast, timeSinceLast)} vvvvvvvv`));
        }
        else {
          console.log(chalk.yellow(`======== ${printCoin('ETN')} ${renderBlockInfo(difficulty, lastDifficulties['ETN'], height, secondsSinceLast, timeSinceLast)} ========`));
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

function checkXTLDifficulty() {
  getXTLDifficulty()
    .then(([difficulty, height] : [number, number]) => {
      difficultiesErrorCount['XTL'] = 0;
      let timeSinceLast = new Date().getTime() - lastBlocks['XTL'];
      if (lastHeights['XTL'] !== height) {
        lastBlocks['XTL'] = new Date().getTime();
        lastHeights['XTL'] = height;
      }
      if (lastDifficulties['XTL'] !== difficulty) {
        const diff = difficulty - lastDifficulties['XTL'];
        const secondsSinceLast = (timeSinceLast / 1000).toFixed(1);
        if (diff > 0) {

          console.log(chalk.red(`^^^^^^^^ ${printCoin('XTL')} ${renderBlockInfo(difficulty, lastDifficulties['XTL'], height, secondsSinceLast, timeSinceLast)} ^^^^^^^^`));
        }
        else if (diff < 0) {
          console.log(chalk.green(`vvvvvvvv ${printCoin('XTL')} ${renderBlockInfo(difficulty, lastDifficulties['XTL'], height, secondsSinceLast, timeSinceLast)} vvvvvvvv`));
        }
        else {
          console.log(chalk.yellow(`======== ${printCoin('XTL')} ${renderBlockInfo(difficulty, lastDifficulties['XTL'], height, secondsSinceLast, timeSinceLast)} ========`));
        }
        lastDifficulties['XTL'] = difficulty;
        difficultyEmitters['XTL'].emit('difficulty', difficulty);
      }
    })
    .catch(error => {
      difficultiesErrorCount['XTL']++;

      // if (etnDifficultyErrorCount > 1) {
      //   slowAllOrders();
      // }
      console.log('error getting difficulty', error);
    });
}

function getXTLDifficulty() {
  return new Promise((resolve, reject) => {
    xtlDaemonGetInfo((error, response) => {
      if (error) return reject(error);//return console.error('getinfo error', error);
      // console.log(response);
      resolve([response.difficulty, response.height]);
    });
  });
}

runAndSchedule(checkOrders, 10 * 1000);

setTimeout(() => {
  // runAndSchedule(projectDifficulty, 10 * 1000);

  runAndSchedule(() => updateOrdersStats(0, algo), 10 * 1000);
  runAndSchedule(() => updateOrdersStats(1, algo), 10 * 1000);

  getAndManageOrders(0, 22);
  getAndManageOrders(1, 22);
}, 1500);

Object.values(difficultyEmitters).forEach(emitter => {
  emitter.on('difficulty', () => {
    printInfo();
  });
});



function checkTRTLDifficulty() {
  getTrtlDifficulty()
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

          console.log(chalk.red(`^^^^^^^^ ${printCoin('TRTL')} ${renderBlockInfo(difficulty, lastDifficulties['TRTL'], height, secondsSinceLast, timeSinceLast)} ^^^^^^^^`));
        }
        else if (diff < 0) {
          console.log(chalk.green(`vvvvvvvv ${printCoin('TRTL')} ${renderBlockInfo(difficulty, lastDifficulties['TRTL'], height, secondsSinceLast, timeSinceLast)} vvvvvvvv`));
        }
        else {
          console.log(chalk.yellow(`======== ${printCoin('TRTL')} ${renderBlockInfo(difficulty, lastDifficulties['TRTL'], height, secondsSinceLast, timeSinceLast)} ========`));
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

function checkCryptopiaPrice(symbol) {
  return new Promise((resolve, reject) => {
    fetchUrl(`https://www.cryptopia.co.nz/api/GetMarket/${symbol}_BTC`, (error, meta, body) => {
      if (error) return reject(error);

      try {
        const {Data:{BidPrice}} = JSON.parse(body.toString()),
              satoshis = stringToSatoshis(BidPrice);

        console.log(`${printCoin(symbol)} PRICE [cryptopia]:`, chalk.yellow(satoshis.toString()));
        exchangePrices['cryptopia'][symbol] = satoshis;
        return resolve(satoshis);
      }
      catch (e) { return reject(e); }
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

      try {
        const {buy} = JSON.parse(body.toString());

        const prices = Object.keys(buy).map(stringToSatoshis);

        prices.sort((a, b) => a < b ? -1 : 1).reverse();

        if (prices.length > 0) {
          console.log(`${printCoin(symbol)} PRICE [tradeogre]:`, chalk.yellow((prices[0] || 0).toString()));
          exchangePrices['tradeogre'][symbol] = prices[0] || 0;
          return resolve(prices[0]);
        }
        return resolve(0);
      }
      catch (error) {
        reject(error);
      }
    });
  });
}

function checkTradeSatoshiPrice(symbol) {
  return new Promise((resolve, reject) => {
    fetchUrl(`https://tradesatoshi.com/api/public/getmarketsummary?market=${symbol}_BTC`, (error, meta, body) => {
      if (error) return reject(error);
       // return console.error(`Error checking ${symbol} price`, error);
      try {
        const result = JSON.parse(body.toString());

        if (result.success) {
          const satoshis = stringToSatoshis(result.result.bid.toFixed(8));
          console.log(`${printCoin(symbol)} PRICE [tradesatoshi]:`, chalk.yellow(satoshis.toString()));
          exchangePrices['tradesatoshi'][symbol] = satoshis;
          return resolve(satoshis);
        }
        return resolve(0);
      }
      catch (error) {
        reject(error);
      }
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
  // console.log('sts', str);
  const [big, little] = str.toString().split('.');
  return parseInt((little || '').padEnd(8, '0')) + parseInt(big) * 100000000
}

function getCoinFromPoolUser(pool_user) {
  switch (pool_user) {
    case 'TRTLv1W1So77yGbVtrgf8G4epg5Fhq9hEZvpZC8ev86xRVLYsQQMHrxQG92QVjUU3bcE6ThGw9vSbEHBMejJpexE2sdrTC24ZXR.600000': return 'TRTL';
    case 'etnk1FzHAgEH2p15Usyzy5UhYocszGggwFaHE6k8Z1ZSBE4kww7azLkT3qgVFgKn5LaVxV9NRssPu5PsWLtJteZw9v6yhMEVRA.600000': return 'ETN';
    case 'Se31xtpSdztCAmrDVd8zmp7TCFtHm1LjrQx9zUgi6rByS6iQTP6T2FY1vhxcRMPURx9sYXTqTWCxuPE6aKbwHHhT1WYcsKDWy':
    case 'Se31xtpSdztCAmrDVd8zmp7TCFtHm1LjrQx9zUgi6rByS6iQTP6T2FY1vhxcRMPURx9sYXTqTWCxuPE6aKbwHHhT1WYcsKDWy.600000': return 'XTL';
    case '5iJjH9UH36SgL367R3F6WD638qQmeRyWrEXFnTKURLtZW196MdueJ6TJnJJN4PEnRhM6au2QYRLdmNoyta2Qwax71irJXuU.600000': return 'MSR';
    case 'GMPHYf5KRkcAyik7Jw9oHRfJtUdw2Kj5f4VTFJ25AaFVYxofetir8Cnh7S76Q854oMXzwaguL8p5KEz1tm3rn1SA6ntd2X7G1ZENVN6Sdh+600000': return 'GRFT';
    case 'iz44v9Cs9XtPAXqdTwAbQPBMNqQWhY1ns77imdefBk641UfEsVN8zLqAFjrtHbaMv1TygTcvJWzGN3zNR6PeEYuc1w8UuQafE.745d0a1a35ba0813fb28d39585698613a31ee26d0921621f40797823f18f2adf+600000': return 'ITNS';
  }
}

function getAndManageOrders(location, algo) {
  getMyOrders(location, algo)
  // nh.getMyOrders(location, algo)
    .then((orders : Array<any>) => {
      orders.forEach(order => {
        const {id, price, limit_speed, pool_user, pool_host} = order,
              coin = getCoinFromPoolUser(pool_user);

        if (managedOrders[coin]) manageOrder(id, stringToSatoshis(price), Object.assign({}, config, {pool_host, location, algo, limit: parseFloat(limit_speed)}), nh, limitFn[coin], coin);
      });
    })
    .catch(error => console.error('ERROR getting and managing orders', location, algo, error));
}

function getMyOrders(location, algo) {
  return new Promise((resolve, reject) => {
    nh.getMyOrders(location, algo)
      .then(response => {
        const orders = response.body.result.orders;
        broadcast(JSON.stringify(['my_orders', {location, algo, orders}]));
        resolve(orders);
      })
      .catch(reject);
  });
}

function getCheapestFilledAtLimit(location, algo, limit) {
  const orders = latestOrders[location][algo];

  for (let i = orders.length - 1; i >= 0; i--) {
    const order = orders[i];

    if (parseFloat(order.accepted_speed) * 1000 >= limit && order.workers > 0) return order;
  }
}

function getPriceForLimit(location, algo, limit, currentWorkers) {
  const orders = latestOrders[location][algo],
        {hashrate_per_worker} = latestLocationInfo[location][algo];

  let workerCount = 0;
  for (let i = orders.length - 1; i >= 0; i--) {
    const order = orders[i];

    // console.log(order.price);

    workerCount += order.workers;

    if (workerCount * hashrate_per_worker >= limit) {
      return order;
    }
  }
  return orders[0]; //?
}

const cheapestGreaterThan1MHAtLocation = {},
      cheapestFilledAtLocation = {};

function checkLocationOrders(location, algo) {
  nh.getOrders(location, algo)
    .then((result) => {
      const orders = result.body.result.orders.filter(order => order.type === 0).sort((a, b) => parseFloat(a.price) > parseFloat(b.price) ? -1 : 1);

      latestOrders[location][algo] = orders;

      broadcast(JSON.stringify(['orders', {location, algo, orders}]));

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

      printInfo();
    })
    .catch(error => console.log('error getting orders', location, algo, error));
}


function printOrdersSummary(location, algo, orders = []) {
  const total_speed = orders.reduce((sum, {accepted_speed}) => sum + parseFloat(accepted_speed) * 1000, 0),
        total_workers = orders.reduce((sum, {workers}) => sum + workers, 0),
        hashrate_per_worker = total_speed / total_workers;


  const cheapestFilled = cheapestFilledAtLocation[location],
        cheapestGreaterThan1MH = cheapestGreaterThan1MHAtLocation[location],
        price = stringToSatoshis(cheapestFilled.price) + 10000;

  const rois = ['TRTL', 'XTL', 'ETN', 'MSR', 'ITNS', 'GRFT'].map(coin => `${printCoin(coin)}:${printROI(calculateROI(coin, lastDifficulties[coin], price))}`).join('|');

  const s = `${renderLocation(location)}[ROI|${rois}][${printMarketSummary(orders)}]${renderAlgo(algo)}[${orders.length} orders](${total_speed.toFixed(2)} MH/s){${total_workers} w)}[${hashrate_per_worker.toFixed(6)} MH/s/w]`;

  console.log(s);

  latestLocationInfo[location][algo] = {total_speed, total_workers, hashrate_per_worker, cheapestFilled};
}

function printMarketSummary(orders) {
  // const total_workers = orders.reduce((sum, {accepted_speed}) => sum + parseFloat(accepted_speed) * 1000, 0);
  const {max, min} = orders.filter(order => order.alive).reduce((agg, order) => (agg.min = Math.min(agg.min, parseInt(order.workers) > 0 ? stringToSatoshis(order.price) : Infinity), agg.max = Math.max(agg.max, stringToSatoshis(order.price)), agg), {max: -Infinity, min: Infinity}),
        bins = 5,
        binSize = (max + 1 - min) / bins;

  const speed_price_histo = orders.filter(order => order.alive && stringToSatoshis(order.price) >= min).reduce((h, order) => (h[Math.floor((stringToSatoshis(order.price) - min) / binSize)] += parseFloat(order.accepted_speed) * 1000, h), new Array(bins).fill(0));

  // console.log({max, min, bins, binSize, speed_price_histo});
  return `${printPrice(min / 100000000)}|${speed_price_histo.map(speed => speed.toFixed(1)).join('|')}|${printPrice(max / 100000000)}||${printPrice(binSize/100000000)}`;
}

function checkOrders() {
  checkLocationOrders(0, algo);
  checkLocationOrders(1, algo);
}

function getTrtlDifficulty() {
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

function startPool(host) {
  console.log('start pool', host);
  const ssh = spawn('ssh', [`core@${host}`, `"cd turtle-pool && ./run"`], {shell: true});

  // ssh.stdout.on('data', data => console.log('start pool: ', data.toString()));
  // ssh.stderr.on('data', data => console.log('ERROR start pool: ', data.toString()));
  ssh.on('close', code => console.log('start pool ended with code', code));

  poolStatus[host] = 'started';
}

function stopPool(host) {
  console.log('stop pool', host);
  const ssh = spawn('ssh', [`core@${host}`, `"cd turtle-pool && docker kill turtlepool-pool"`], {shell: true});

  ssh.stdout.on('data', data => console.log('stop pool: ', data.toString()));
  ssh.stderr.on('data', data => console.log('ERROR stop pool: ', data.toString()));
  ssh.on('close', code => console.log('stop pool ended with code', code));

  poolStatus[host] = 'stopped';
}

function manageOrder(order, price, {pool_host, threshold, roiThreshold, roiEndThreshold, limit, minimumMineTime, location, algo}, nh, calculateLimit, coin) {
  console.log('Now managing', order, 'on', renderLocation(location), coin);
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

    if (poolStartFn[coin]({roi}) && poolStatus[pool_host] !== 'started') startPool(pool_host);
    else if (poolStopFn[coin]({roi}) && poolStatus[pool_host] !== 'stopped') stopPool(pool_host);

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

    if (newLimit > 0.01) {
      setTimeout(() => {
        // const price = parseFloat(cheapestGreaterThan1MHAtLocation[location].price) + 0.0002;
        const price = pricingStrategies[coin]({location, algo, newLimit, price: orderData.price, workers: ordersDB[coin][location][algo][orderData.order].workers || 0});

        if (orderData.price < price && !orderData.settingPrice) {
          orderData.settingPrice = true;
          nh.setOrderPrice({location, algo, order, price: price / 100000000})
            .then(response => {
              orderData.settingPrice = false;
              console.log(chalk.yellow('set order price response', JSON.stringify(response.body)));
              if (response.body.result.success) orderData.price = price;
            })
            .catch(error => {
              orderData.settingPrice = false;
              console.log('error setting price', error);
            });
        }
      }, Math.random() * 3 * 1000);
    }
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

function getBestExchange(coin) {
  const coinExchanges = Object.keys(exchanges).reduce((e, exchange) => {
    if (exchanges[exchange].coins.indexOf(coin) >= 0) e.push(exchange);
    return e;
  }, []);

  let price = 0, exchange;
  for (let i = 0; i < coinExchanges.length; i++) {
    const exchangePrice = exchangePrices[coinExchanges[i]][coin];
    if (exchangePrice > price) {
      exchange = coinExchanges[i];
      price = exchangePrice;
    }
  }
  return exchange;
}

function getBestExchangePrice(coin) {
  const coinExchanges = Object.keys(exchanges).reduce((e, exchange) => {
    if (exchanges[exchange].coins.indexOf(coin) >= 0) e.push(exchange);
    return e;
  }, []);

  let price = 0;
  for (let i = 0; i < coinExchanges.length; i++) {
    const exchangePrice = exchangePrices[coinExchanges[i]][coin];
    if (exchangePrice > price) price = exchangePrice;
  }
  return price;
}

function calculateROI(coin, difficulty, niceHashBTCPrice) {
  const payout = (1000000 * 86400) / difficulty * networkRewards[coin],
        // cost = niceHashBTCPrice / exchangePrices[currentExchange[coin]][coin],
        cost = niceHashBTCPrice / getBestExchangePrice(coin),
        profit = payout - cost,
        roi = profit /cost - 0.03; // 3% nicehash fee!

  return roi;
}

function runAndSchedule(fn, interval) {
  setInterval(fn, interval);
  fn();
}

function updateOrdersStats(location, algo) {
  return getMyOrders(location, algo)
  // return nhRequest('getMyOrders', [location, algo])
    .then((orders : Array<any>) => {
      orders.forEach(order => {
        order.location = location;
        order.coin = getCoin(order.pool_user);
        ordersDB[order.coin || 'unknown'][location][algo][order.id] = Object.assign(ordersDB[order.coin || 'unknown'][location][algo][order.id] || {}, order);
        // if (!order.alive) {
        //   for (let i = managedOrders.length - 1; i >= 0; i--) {
        //     if (managedOrders[i].id === order.id) managedOrders.splice(i, 1);
        //   }
        // }
      });
      // printOrders(location, algo);
      printInfo();
    })
    .catch(error => console.log('Error updating order stats', error));
}

function getCoin(pool_user) {
  switch (pool_user) {
    case 'TRTLv1W1So77yGbVtrgf8G4epg5Fhq9hEZvpZC8ev86xRVLYsQQMHrxQG92QVjUU3bcE6ThGw9vSbEHBMejJpexE2sdrTC24ZXR.600000': return 'TRTL';
    case 'etnk1FzHAgEH2p15Usyzy5UhYocszGggwFaHE6k8Z1ZSBE4kww7azLkT3qgVFgKn5LaVxV9NRssPu5PsWLtJteZw9v6yhMEVRA.600000': return 'ETN';
    case 'Se31xtpSdztCAmrDVd8zmp7TCFtHm1LjrQx9zUgi6rByS6iQTP6T2FY1vhxcRMPURx9sYXTqTWCxuPE6aKbwHHhT1WYcsKDWy':
    case 'Se31xtpSdztCAmrDVd8zmp7TCFtHm1LjrQx9zUgi6rByS6iQTP6T2FY1vhxcRMPURx9sYXTqTWCxuPE6aKbwHHhT1WYcsKDWy.600000': return 'XTL';
    case 'dERoMN3xY15U2hL8yJeHPGQN2YaRWSTmcdvFEC9rjQUz1qDFnxTk7xeJVQkRkbfR5cNFPSNynviNsPXRxHELvfo28tXuUfwRBZ.600000': return 'DER';
    case '5iJjH9UH36SgL367R3F6WD638qQmeRyWrEXFnTKURLtZW196MdueJ6TJnJJN4PEnRhM6au2QYRLdmNoyta2Qwax71irJXuU.600000': return 'MSR';
    case 'iz44v9Cs9XtPAXqdTwAbQPBMNqQWhY1ns77imdefBk641UfEsVN8zLqAFjrtHbaMv1TygTcvJWzGN3zNR6PeEYuc1w8UuQafE.745d0a1a35ba0813fb28d39585698613a31ee26d0921621f40797823f18f2adf+600000': return 'ITNS';
    case 'GMPHYf5KRkcAyik7Jw9oHRfJtUdw2Kj5f4VTFJ25AaFVYxofetir8Cnh7S76Q854oMXzwaguL8p5KEz1tm3rn1SA6ntd2X7G1ZENVN6Sdh+600000': return 'GRFT';
  }
  return 'unknown';
}

let lastBTCAvail = 0;

function printInfo() {
  console.log('----------------------');

  printOrdersSummary(0, algo, latestOrders[0][algo]);
  printOrdersSummary(1, algo, latestOrders[1][algo]);
  console.log('**********************');
  printAllOrders();
  printExchangeSummary();
  printWalletSummary();
  console.log('---------------------');

  // ,.-'`
}

function printAllOrders() {
  Object
    .keys(ordersDB)
    .forEach(coin => {
      const coinDB = ordersDB[coin],
            usa = Object.values(coinDB['1'][22]),
            eur = Object.values(coinDB['0'][22]),
            combined = usa.concat(eur),
            total_limit = combined.reduce((sum, order) => sum + parseFloat(order.limit_speed), 0),
            accepted_speed = combined.reduce((sum, order) => sum + parseFloat(order.accepted_speed) * 1000, 0),
            total_workers = combined.reduce((sum, order) => sum + order.workers, 0),
            limit_hourly_rate = combined.reduce((sum, order) => {
              const costPerHour = parseFloat(order.limit_speed) * parseFloat(order.price) / 24;
              return sum + (costPerHour * (1 + calculateROI(coin, lastDifficulties[coin], stringToSatoshis(order.price))) - costPerHour);
            }, 0),
            accepted_hourly_rate = combined.reduce((sum, order) => {
              const costPerHour = parseFloat(order.accepted_speed) * 1000 * parseFloat(order.price) / 24;
              return sum + (costPerHour * (1 + calculateROI(coin, lastDifficulties[coin], stringToSatoshis(order.price))) - costPerHour);
            }, 0),
            estimated_hashrate = usa.reduce((sum, order) => sum + order.workers, 0) * latestLocationInfo[1][22]['hashrate_per_worker'] + eur.reduce((sum, order) => sum + order.workers, 0) * latestLocationInfo[0][22]['hashrate_per_worker'];

      if (usa.length > 0 || eur.length > 0) console.log(`\n${printCoin(coin)} (${usa.length+eur.length}) [${lastDifficulties[coin]}] (${printWorkers(total_workers)} w) [l:${printLimit(total_limit.toFixed(2))}.a:${printLimit(accepted_speed.toFixed(2))}.e:${printLimit(estimated_hashrate.toFixed(2))}| l:<B${printRate(limit_hourly_rate)}/hr>a:<B${printRate(accepted_hourly_rate)}/hr>`);

      if (usa.length > 0) {
        console.log(` USA (${usa.length})`)
        for (let i = 0; i < usa.length; i++) console.log(`  ${formatOrder(usa[i])}`);
      }

      if (eur.length > 0) {
        console.log(` EUR (${eur.length})`);
        for (let i = 0; i < eur.length; i++) console.log(`  ${formatOrder(eur[i])}`);
      }
    });

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

    console.log('\nBTC AVAIL:', btc_avail / 100000000, 'from', orders, 'orders');
    lastBTCAvail = btc_avail;
}

function printExchangeSummary() {
  const summary =
    Object
      .keys(exchangePrices)
      .map(exchange => `[${exchange}: (${Object.keys(exchangePrices[exchange]).map(coin => `${printCoin(coin)}: ${exchangePrices[exchange][coin]}`).join(', ')})]`);

  console.log(summary.join(' '));
}

function printWalletSummary() {
  console.log(Object.keys(walletBalances).map(coin => `${coin}: ${JSON.stringify(walletBalances[coin])}`).join(' '));
}

function printOrders(location, algo) {
  Object.values(ordersDB).forEach(coinDB => Object.values(coinDB[location][algo]).forEach(printOrder));

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

function groupBy(list, selector) {
  return list.reduce((groups, item) => {
    const key = selector(item);
    (groups[key] = groups[key] || []).push(item);
    return groups;
  });
}

function mergeGroupings(g1, g2) {
  const merged = {};

  Object.keys(g1).forEach(key => merged[key] = [].concat(g1[key]));
  Object.keys(g2).forEach(key => merged[key] = (merged[key] = merged[key] || []).concat(g1[key]));

  return merged;
}

const lastPrints = {
  '0': {
    '22': {}
  },
  '1': {
    '22': {}
  }
};

function printOrder(order) {
  const s = formatOrder(order),
        {location, algo, id} = order;

  if (s != lastPrints[location][algo][id]) console.log(s);

  lastPrints[location][algo][id] = s;
}

function formatOrder({id, coin, algo, btc_avail, limit_speed, price, end, workers, btc_paid, location, accepted_speed, alive}) {
  const avail = parseFloat(btc_avail),
        paid = parseFloat(btc_paid),
        roi = calculateROI(coin, lastDifficulties[coin], stringToSatoshis(price)),
        limitCostPerHour = limit_speed * price / 24,
        limitProfitPerHour = limitCostPerHour * (1 + roi) - limitCostPerHour,
        acceptedCostPerHour = (parseFloat(accepted_speed) * 1000) * price / 24,
        acceptedProfitPerHour = acceptedCostPerHour * (1 + roi) - acceptedCostPerHour,
        {workersAbove, workersBelow} = separateWorkersOnOrder(id, location, algo, price),
        marketPosition = workersBelow / (workersAbove + workersBelow),
        priceForLimit = (getPriceForLimit(location, algo, limit_speed, workers) || {price: 0}).price,
        roiAtCheapest = calculateROI(coin, lastDifficulties[coin], stringToSatoshis(priceForLimit));

  const s = `|${renderProgress(1 - (avail / (avail + paid)))}| ${printROI(roi)} ROI [B ${printPrice(price)}|B ${printPrice(priceForLimit)}|${((price - priceForLimit) / priceForLimit * 100).toFixed(1)}% (${printROI(roiAtCheapest)} ROI)][${printLimit(limit_speed)} limit <B${printRate(limitProfitPerHour)}/hr>][${printSpeed((parseFloat(accepted_speed) * 1000))} MH/s <B${printRate(acceptedProfitPerHour)}/hr>][${printWorkers(workers)} w (${(marketPosition * 100).toFixed(1)}%)] [${avail.toFixed(5)} avail] ${id}`;

  return alive ? s : `${chalk.bgRed('D')}${s}`;
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
    case 'XTL': return chalk.magenta(coin);
    case 'DER': return chalk.cyan(coin);
    case 'MSR': return chalk.red(coin);
    case 'ITNS': return chalk.yellow(coin);
    case 'GRFT': return chalk.bgBlue(coin);
    case 'BTC': return chalk.yellow(coin);
  }
  return coin;
}
function printPrice(price) { return chalk.yellow(parseFloat(price).toFixed(4)); }
function printRate(rate) { return chalk[rate < 0 ? 'red' : 'green'](rate.toFixed(4)); }
function printSpeed(speed) { return chalk[speed > 0.01 ? 'blue' : 'grey'](speed.toFixed(2))}
function printWorkers(workers) { return (workers > 0 ? chalk.bgGreen : chalk.bgRed)(workers); }


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