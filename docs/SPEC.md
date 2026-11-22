# nicebot spec

TypeScript replacement for the NiceHash buyer bot. This document is the contract for the `modern-roi-prototype` branch. It records what the old bot did, what this research pass proved, and how the new system is built.

The bot rents hashrate on NiceHash, points it at pools we operate, mines coins whose revenue exceeds the rent, sells those coins, and puts the BTC back into orders. It never places or raises an order unless calculated ROI is strictly greater than 1.

## 1. History

Repository: `github.com/blakelapierre/nicebot`. Two branches exist today.

| Branch | Tip | What it is |
|---|---|---|
| `master` | `b573417` checkpoint | The historical bot. One long line of commits, no other live branches. |
| `modern-roi-prototype` | this spec | New work. Do not rewrite `master`. |

`master` commit themes, oldest ideas first:

- NiceHash API v1 client (`API_ID` / `API_KEY`), gulp dev server.
- CryptoNight only. Markets were EUR and USA. Default coin was IPBC.
- Live daemon RPCs for many CryptoNote coins at once: TRTL, ETN, XTL, ITNS, MSR, GRFT, PLURA, XHV, XUN, IPBC, BSM, OMB, DERO. Each had its own wallet RPC and daemon RPC on fixed local ports.
- Difficulty was read from those daemons (`lastDifficulties`). Rewards were hardcoded (`networkRewards`).
- ROI was a CryptoNight shortcut, not a general formula. See section 3. Orders were slowed, not deleted, when ROI was bad. A desired hashrate cap (`desiredRate = 2`) and a floor (`minROI = 0.19` in one path) decided the limit.
- Order create path (left commented): 0.015 BTC, price 0.0001, pool host `*-mining-proxy.p2p.ninja:9999`, pool user `eur` or `usa`, pool pass used as the routing key.
- A cryptonight-proxy config (`configs/cryptonight-proxy/config.json`) mapped a pool pass / symbol onto a real pool (TRTL, MSR, ETN, ITNS, GRFT, XTL). The bot told the proxy which coin to use (`setProxyCoin`).
- Exchanges: TradeOgre (primary), KuCoin, stocks.exchange, TradeSatoshi, Cryptopia. Auto-sell was a later commit. Balances and prices were broadcast to the GUI.
- GUI: Preact, websocket on port 5555. It showed orders (own orders highlighted), wallet balances, exchange prices, and proxy stats. The server kept the last 10 broadcasts for new clients.
- Pools file was a static host list (TRTL and XAO on a few VPS addresses). No pool builder, no VM isolation, no maturity control.
- Container scripts existed to build and publish a Docker image. They are not the deployment model below.

What is wrong with the old ROI, and must not be ported:

```
payout = (1e6 * 86400) / difficulty * networkReward
cost   = niceHashPrice / exchangePrice
roi    = (payout - cost) / cost - 0.03
```

That assumes 1 MH/s, a CryptoNight difficulty, and a price already in the old API's units. It also subtracts the 3% fee from the ratio instead of applying it to cost. TradeOgre is gone. The v1 order shape (`workers`, `accepted_speed`, `pool_pass`) is not the v2 API.

The two files already on this branch (`src/modern/roi-prototype.ts`, `src/modern/roi-scanner.ts`) are experiments. They are not correct. `simplemultialgo.paying` is about 10,000× smaller than the real BTC-per-TH order price on KawPow. Do not use `paying` as the buyer price. The formula in section 4 replaces them.

## 2. What the new bot does

One process, the orchestrator, owns the loop:

1. Pull network stats and the NiceHash order book for every enabled algorithm.
2. Compute ROI per coin at the price we would actually have to pay to receive hashrate.
3. Decide, per algorithm, how to split a limited BTC budget across coins.
4. Create, reprice, resize, pause, or delete our orders so they match that plan.
5. Point the stratum proxy for each order at the pool for that coin.
6. Pools we run pay our wallet with zero confirmation hold.
7. Watch wallets. Coins that are spendable are sold. BTC is withdrawn back to the NiceHash account that pays the orders.
8. Repeat. The GUI is a view of this state, not a second controller.

Language is TypeScript, run as Node. The old gulp/babel app stays on `master` and is not the runtime.

## 3. Rules that do not bend

- ROI > 1 or the order does not grow. New orders are created only above 1. Existing orders above 1 may be raised in price or limit. At or below 1 the order is set to the algorithm minimum speed, or deleted if it has been below 1 longer than `pauseGrace`.
- ROI is timeless. `btcOut = btcSpent * roi` over any window where difficulty, coin price, and hashprice do not move. Time is not part of the ratio. Time only limits how much hashrate the book can absorb.
- Price comes from the v2 order book, not from `simplemultialgo`.
- One NiceHash algorithm is one book. KawPow bought for Neoxa cannot also mine Ravencoin. Orders on the same algorithm compete for the same rigs. The optimizer splits that book; it does not double-count it.
- Do not buy more hashrate than `maxNetworkFraction` of a coin (default 0.10). Past that we are the difficulty change and the ROI we just measured is false. This is the lesson from CryptoNote oscillation and from Ravencoin DGW, and it still applies to ASERT coins if the order is large relative to the network.
- Dust is not a price. An order at the minimum price with negligible `acceptedSpeed` is ignored. The price used for "what we must pay" is the price at which hashrate is actually being delivered, walking down from the top of the book.
- Our pools charge the operator 0%. NiceHash still charges its buyer fee (3% as of this research). The fee is applied to cost, so `roiAfterFee = revenue / (price * 1.03)`. The gate stays ROI > 1 after the fee. A coin at 1.06 before the fee is not a buy.
- Our pools credit the operator wallet with a block maturity of 0. No freeze, no "unlocked after N blocks" hold. A reorg reverses the credit in our own wallet. We do not pay third-party miners.
- Secrets (NiceHash key, wallet RPC passwords, exchange keys, SSH keys for VMs) come from the environment or a local file that is gitignored. They are never committed. The old tree had an API key in history; new code must not repeat that.

## 4. ROI

### 4.1 Identity

For one displayed price unit (1 TH, 1 EH, 1 GSol, 1 MSol, whatever `displayPriceFactor` says):

```
share        = priceFactor / nethash
coinsPerDay  = share * (86400 / blockTime) * blockReward
revenue      = coinsPerDay * btcPerCoin          // BTC per unit per day
cost         = orderPrice * (1 + buyerFee)       // BTC per unit per day
roi          = revenue / cost
```

`priceFactor` is the integer on the order book (`1000000000000` for TH). `nethash` is hashes per second, or solutions per second when the unit is Sol. They must be the same physical unit. `orderPrice` is the order's `price` field. On current NiceHash that field is BTC per `displayPriceFactor` per day.

Speed on the book is in `displayMarketFactor`, which is not always the price unit. NexaPow price is TH and speed is GH. Accepted speed is converted with `marketFactor` before it is turned into a count of price units:

```
hashes        = acceptedSpeed * marketFactor
priceUnits    = hashes / priceFactor
spendPerDay   = priceUnits * orderPrice
```

Check the nethash. For Ravencoin, `nethash = difficulty * 2^32 / blockTime`. For Nexa the same identity held against WhatToMine. If a coin's published nethash does not match its difficulty formula, do not trade it until the unit is identified. Beam and Equihash are solutions; their `priceFactor` is `1e6` (MSol) or `1e9` (GSol), not hashes.

`btcPerCoin` is the WhatToMine `exchange_rate` when `exchange_rate_curr` is BTC. If the feed quotes USD (Bitcoin's row does), convert with a live BTCUSD price. Never multiply a USD quote as if it were BTC.

### 4.2 Which price

Walk orders that are alive and have `acceptedSpeed > 0`, highest price first. That is the hashrate we can actually take, because higher prices are served first.

- `frontPrice` is the highest such price. Matching it is what it costs to be first in line.
- `weightedPrice` is the accepted-speed-weighted mean. It describes the market. It is not a price we can buy the whole book at, because the cheap tail is behind the front.
- To take `Q` price-units we pay the prices of the orders we would have to outbid, from the front down, until their accepted speed sums to `Q`. ROI for that slice uses that marginal cost, not the average.

`simplemultialgo.paying` is recorded only as a diagnostic. On KawPow it was ~1/10000 of the order-book TH price. Using it produced a fake ROI near 7 for Ravencoin when the real ratio was about 0.75.

### 4.3 Worked checks the engine must reproduce

These were measured against live feeds during this research. The test fixtures store the raw JSON and assert the ratio, not a live call.

Ravencoin, KawPow. nethash 516,229,581,198 H/s, block time 60 s, reward 1250, price 1.52115e-8 BTC. Revenue of 1 TH/s was 0.05304 BTC/day. The delivered book sat between 0.0612 and 0.0801 BTC/TH/day. Weighted price ~0.0717. ROI at the weighted price ~0.74, at the front ~0.66. Below 1. A 0.0499 order with micro-speed is dust.

Nexa. nethash 1,332,990,995,977 H/s, block time 120 s, reward 5,000,000, price 7.312e-12 BTC. Revenue of 1 TH/s was 0.019748 BTC/day. The only filled order was 0.008 BTC/TH/day, speed reported in GH (9.82 GH/s = 0.00982 TH/s). ROI 2.468 before the buyer fee, 2.397 after 3%. WhatToMine's own revenue at 216.77 MH/s scales to the same per-TH number. The whole book cost about $4.59/day at BTC $59,068. It is 0.74% of the network, so it does not move difficulty.

### 4.4 Difficulty, and why the cap exists

ROI above is steady-state at the current difficulty. It stays true only while we do not change that difficulty.

CryptoNote (the coins the old bot mined) used a long simple average, typically 720 blocks, plus timestamp cutting. A rented spike found many blocks before difficulty noticed. When the hash left, the window was still hot, blocks stalled, and the next slow blocks drove difficulty below the hashrate that remained. That undershoot is the cycle. The old bot was built around it.

Ravencoin uses Dark Gravity Wave v3 (`DarkGravityWave` in `RavenProject/Ravencoin` `src/pow.cpp`). Window 180 blocks, target 60 s. Next target is the average of those targets times actualTimespan/targetTimespan, and the timespan is clamped to 1/3 … 3×. One block can triple difficulty or cut it to a third. Pointing the whole KawPow book (~0.14 TH) at Neoxa (~0.01 TH) is that spike. Pointing it at Ravencoin (~0.52 TH) is not.

Nexa uses ASERT (`aserti3-2d`), half-life 172,800 s, 120 s target. A shock decays exponentially. There is no undershoot to farm. The 2.47× is a standing spread, not a one-hour cycle. "Cycle the bankroll" cannot create hashrate the book does not have.

Default `maxNetworkFraction` is 0.10 of the coin's current nethash, and never more than the accepted speed actually for sale. The cap is per coin. Leftover speed on that algorithm may be offered to the next coin, each under its own cap.

### 4.5 Merge mining

Scrypt revenue is the sum of coins a single share can pay, not the best one. LTC alone was ~0.18. DOGE alone was ~0.99. A pool that merge-mines both is about 1.17, which still lost to the higher-ROI books. The engine sums only coins flagged `mergeGroup`. Quai's Scrypt shard is not in the LTC group. Unknown aux coins are not added until flagged.

## 5. Optimizer

Inputs: per-coin ROI after fee, the accepted-speed curve and prices of each book, our NiceHash BTC available (not locked in live orders), wallet BTC in flight, `maxNetworkFraction`, and a reserve that is never spent.

Output: a list of desired orders.

```
{ algorithm, market, coin, price, limit, poolId }
```

Algorithm:

1. Drop coins with missing stats, lagging feeds, ROI ≤ 1 after fee, or no pool ready.
2. For each algorithm, walk coins by ROI descending. Give each coin up to 10% of its nethash, limited by the speed still unsold in the walk down the book. Record the price required to take that slice (one tick above the order we must beat, respecting `priceDownStep` and `minPrice`).
3. Convert each slice to BTC/day. This is the most the market will sell us at a true ROI > 1.
4. If the sum of those BTC/day figures is under our spendable balance, fund all of them. If it is over, fill from the top of the ROI list until the balance is committed. A slice may be partial.
5. Emit the diff against live orders: create, `updatePriceAndLimit`, set limit to the minimum, or delete.

The measured $100 case (BTC ~$59,200, 10% cap, ROI > 1) filled in this order and stopped at $100: NEXA ~$4.56 (ROI 2.47), BEAM ~$7.53 (2.04), NEOX ~$4.54 (1.53), KRGN ~$0.83 (1.50), ALPH ~$46.82 (1.42), ETC ~$16.08 (1.30), QUAI KawPow ~$19.64 (1.22). Profit on that book was about $46/day before the practical friction of repricing. CKB (ROI ~1.15, book ~$143/day, 4.7% of the network) is the first coin that did not fit. ZEC was ~1.07 on a deep book. BTC was 0.99, XMR 0.90, KAS 0.55. Those numbers are a fixture, not a constant. The optimizer recomputes them every cycle.

Reprice slowly. NiceHash sorts by price, then age, and moves rigs gradually. Chasing every tick spends the `down_step` and the order-create fee (0.00001 BTC, not refunded). A reprice is issued only when the ROI gap to the target price exceeds `repriceBand` (default 1%) or our accepted speed has been under half the limit for `starveFor` (default 5 minutes).

Do not place two orders on the same algorithm and coin. Do not place an order with no pool.

## 6. NiceHash loop

API base `https://api2.nicehash.com`. Public reads need no key. Order writes are signed v2 calls (API key, secret, organization id, HMAC-SHA256, `X-Time`).

Public, every cycle:

- `GET /main/api/v2/mining/algorithms` for `priceFactor`, `marketFactor`, `displayPriceFactor`, `displayMarketFactor`, `priceDownStep`, `minSpeedLimit`, `priceScale`.
- `GET /main/api/v2/hashpower/orderBook?algorithm=NAME&page=0&size=1000` for the BTC market. Paginate until the speed we care about is covered.
- `GET /main/api/v2/public/simplemultialgo/info` only for the diagnostic panel.

Private:

- List our orders, balance, and pools.
- Create a pool (`POST /main/api/v2/pool`) pointing at our proxy, not at a coin daemon. The proxy is what switches coins. Pool user encodes `algorithm.coin.orderId`.
- Create or update the order (`POST /main/api/v2/hashpower/order`, `updatePriceAndLimit`). `limit` is in the market factor. `price` is in the price factor. Nexa's limit is in GH while its price is in TH. Getting this backwards buys 1000× too much or too little.
- Delete an order that has been under the ROI gate past `pauseGrace`.

Poll no faster than the public rate limit allows. The orders endpoint returned 429 under a tight loop in this session. Back off on 429. One book per algorithm per cycle is enough, because ROI on these coins does not need sub-minute reads except where we have flagged `fastDifficulty` (small KawPow coins). Those are polled every cycle; large coins can be every few minutes.

Markets: BTC. The USDT SHA-256 book is out of scope until the pricer speaks USDT.

Locations: the v2 API uses algorithm plus market, not the old EUR/USA enum. If an order still requires a location, prefer the region of the proxy that order uses.

## 7. Market data

Two feeds, both required, cross-checked:

- WhatToMine `https://whattomine.com/coins.json` (GPU) and `https://whattomine.com/asic.json` (ASIC). Fields: `tag`, `algorithm`, `nethash`, `difficulty`, `block_time`, `block_reward`, `exchange_rate`, `exchange_rate_curr`, `lagging`. Skip `lagging` and skip `tag === NICEHASH` (those rows are the hashprice itself, not a coin).
- The coin daemon, once we run one. Its tip height, difficulty, and block reward override WhatToMine for coins we operate. WhatToMine remains the price source until the sale loop has a fill.

Algorithm names do not match. The map is data, not code:

| WhatToMine | NiceHash |
|---|---|
| KawPow | KAWPOW |
| NexaPow | NEXAPOW |
| BeamHashIII | BEAMV3 |
| Autolykos | AUTOLYKOS |
| Etchash | ETCHASH |
| Ethash | DAGGERHASHIMOTO |
| Octopus | OCTOPUS |
| Equihash | EQUIHASH |
| RandomX | RANDOMXMONERO |
| Scrypt | SCRYPT |
| SHA-256 | SHA256ASICBOOST |
| X11 | X11 |
| Eaglesong | EAGLESONG |
| kHeavyHash | KHEAVYHASH |
| Blake3 | ALEPHIUM |

`SHA-256` must be normalized before lookup. A hyphenated key missed Bitcoin in the first full scan.

Coins with no WhatToMine row are not traded. That includes VerusHash and NeoScrypt as of this writing. Zhash had only a NiceHash placeholder.

BTCUSD comes from a public ticker (CoinGecko in the research script). It is used only to display dollars and to convert USD-quoted feeds. ROI itself is BTC over BTC.

## 8. Stratum proxy

The proxy is the only address NiceHash is given. It speaks stratum v1 to the rented workers and holds one upstream connection per coin pool.

Requirements:

- Listen on one port per algorithm, or one port with the coin chosen by the pool username. Username format `algorithm.coin.orderId`. The old bot used `pool_pass` for this; v2 pool records have a user field, so the user field is the key.
- Switch upstream when the optimizer changes the coin for that order. In-flight shares are retried on the new upstream. Workers are not disconnected, because NiceHash treats a disconnect as lost speed.
- Per-connection stats: accepted hashes (or sols), rejected, last share time, upstream pool, worker name. These are the hashrate numbers the GUI shows. NiceHash `acceptedSpeed` is the other view of the same thing. A lasting gap between them is a bug (bad difficulty, dev-fee on a miner we don't control, or the proxy dropping shares).
- The proxy does not calculate ROI and does not choose the coin. It does what the orchestrator last wrote.

The old `configs/cryptonight-proxy/config.json` is the behavior to preserve: a table of upstreams, a default, and a runtime switch. The implementation is new, in TypeScript, and is not limited to CryptoNight.

## 9. Pools and machines

We do not point NiceHash at a public pool. Public pools take a fee and hold blocks. Every coin we mine has a pool we run.

Each coin is a VM, so a daemon crash or a bad build cannot take the orchestrator or another coin with it.

- Default host is the bot machine, using local libvirt or a lightweight VM runner.
- If that host cannot fit another VM (CPU, disk, or a daemon that needs the chain history), the builder rents a machine from the configured provider and records the address. Renting is a logged action with a size and a price cap. It does not happen silently past the cap.
- The VM runs only the official daemon and our pool process. No orchestrator, no keys to NiceHash, no exchange keys.
- Images are reproducible: a pinned git revision of the official source, the build command, and the config. The builder clones that source, builds it, and starts it. Prebuilt binaries are not used unless the project ships no source build.

Pool config, all coins:

- Fee 0.
- Block maturity 0. A share that lands in a block we found is credited to the operator wallet on that block, not after N confirmations.
- Payout threshold 0 for the operator. There is one miner, us.
- The pool talks to its local daemon only.
- Wallet address is the operator wallet for that coin, created on first build and stored with the VM record.

The orchestrator reaches a pool only through the proxy and through a metrics socket (height, difficulty, hashrate, blocks found, credits). It does not share a filesystem with the VM.

Coins we have already measured and that are in scope for the first pools, because they cleared ROI > 1 at a sane size: NEXA, BEAM, the small KawPow set (NEOX, KRGN, QUAI, XNA) behind the 10% cap, ALPH, ETC, and CKB when the budget reaches it. ZEC is in scope as a pool only if we choose to take a deep book at ROI barely over 1. A coin does not get a VM until the optimizer has ranked it above 1 for `poolBuildAfter` consecutive cycles (default 3), so we do not build a chain for a one-minute quote.

Daemon RPC replaces WhatToMine nethash and reward for that coin as soon as the tip is synced. Until then the coin is ranked but not ordered.

## 10. Wallets, blocks, and the return path

Block states, in order:

| State | Meaning |
|---|---|
| `found` | Our pool saw the block in the daemon. |
| `credited` | Maturity is 0, so this is the same moment as `found`. The wallet balance includes it. |
| `reorged` | The daemon dropped the block. The credit is reversed. |
| `selling` | A sell order is open on the configured venue. |
| `sold` | The venue filled it. We hold BTC (or a stable we immediately convert). |
| `withdrawing` | BTC is in flight to the NiceHash deposit address. |
| `resupplied` | The NiceHash balance has increased by that amount. The optimizer may use it. |

The GUI shows every block in one of these states. Nothing is called frozen. The old exchange behavior of waiting out a coin's unlock time is intentionally not reimplemented for our own pools.

Selling uses whichever venue currently has a BTC (or USDT-to-BTC) book for that coin. TradeOgre is not assumed. The selector picks the venue with the best bid that can absorb the balance without moving the price more than `maxSlippage` (default 1%). If no venue can, the coins stay `credited` and the GUI says why. We do not market-sell through an empty book.

Withdrawals go to the NiceHash deposit address for the organization that owns the orders. The orchestrator treats in-flight BTC as already allocated, so it does not also try to spend it from the exchange.

## 11. GUI

A single local page. It opens a websocket to the orchestrator, the way the old GUI opened port 5555. It is a view. Clicks that change an order are explicit and confirmed. The optimizer keeps running if the page is closed.

The page shows:

- Per coin we might mine: tag, algorithm, nethash, our hashrate, fraction of the network, block time, reward, BTC price, revenue per unit, cost per unit, ROI before and after fee, cap, and whether a pool exists.
- Per NiceHash algorithm: the book as a price ladder with accepted speed, our orders marked on it, the price we would have to pay for the next slice, and rejects from the API.
- Orders: id, algorithm, coin, price, limit, accepted speed, workers, BTC remaining, age, last action, next action the optimizer wants.
- Proxy: connections, accepted and rejected shares, upstream, switch events.
- Pools and VMs: host, build revision, daemon height against the network height, peer count, pool hashrate, fee (must read 0), maturity (must read 0).
- Wallets: per-coin balance, and every block in the states from section 10.
- Capital: NiceHash free BTC, BTC locked in orders, BTC in flight, coin balances valued at the bid we would actually get, reserve, and today's spent versus returned.
- The optimizer's current plan and the diff it is about to send.
- A log of API errors, 429s, reorgs, and failed sells. This is the debug view. No separate debug tool.

Dollars are a display. The gate is BTC ROI.

## 12. Layout

```
src/
  main.ts                 start orchestrator, proxy, gui socket
  roi.ts                  section 4, pure functions
  optimize.ts             section 5, pure functions
  nicehash.ts             signed v2 client
  feeds.ts                WhatToMine, BTCUSD, daemon stats
  proxy.ts                stratum proxy
  pools/
    builder.ts            clone, build, VM, config
    supervisor.ts         health, metrics
  wallet.ts               block state machine, sell, withdraw
  gui/                    the page and its socket protocol
  config.ts               thresholds named in this spec
test/
  fixtures/               raw API payloads from the RVN and NEXA checks
  roi.test.ts
  optimize.test.ts
docs/SPEC.md              this file
```

The old `src/index.ts` is left in place so the history stays readable. `src/main.ts` does not import it.

Config defaults:

| Name | Default |
|---|---|
| `roiMin` | 1 |
| `buyerFee` | 0.03 |
| `maxNetworkFraction` | 0.10 |
| `pauseGrace` | 15 min |
| `repriceBand` | 0.01 |
| `starveFor` | 5 min |
| `poolBuildAfter` | 3 cycles |
| `maxSlippage` | 0.01 |
| `reserveBtc` | set per deployment, never 0 in production |

## 13. Tests before any live order

- ROI fixtures for the Ravencoin and Nexa payloads in section 4.3, including the GH-versus-TH conversion on Nexa and the dust-order rejection on Ravencoin.
- A book walk that pays the front price for the first slice rather than the average.
- The optimizer, given the fixture books, reproduces the $100 fill order in section 5 and refuses a coin whose book is many times its nethash unless the 10% cap is what gets bought.
- The proxy switches upstream without dropping the downstream connection.
- A pool config test that fails the build if fee is not 0 or maturity is not 0.
- The order client is not called in tests. A dry-run flag prints the diff and sends nothing. Live orders require `LIVE=1` in the environment.

## 14. Out of scope

- Selling hashrate. We are the buyer.
- Hosting miners for anyone else.
- The USDT hashpower market.
- Rewriting a coin's difficulty algorithm. We only refuse to be large enough to abuse one.
- Trusting `simplemultialgo.paying` as a price.
