import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseVenue, emptyBook, markResupplied, markSold, markSelling, markWithdrawing, onBlockFound, onReorg } from '../src/wallet.ts';

test('a found block is credited immediately and a reorg reverses it', () => {
  const book = emptyBook();
  const row = onBlockFound(book, { id: 'b1', tag: 'NEXA', reward: 5_000_000 });
  assert.equal(row.state, 'credited');
  assert.equal(book.balances.NEXA, 5_000_000);
  onReorg(book, 'b1');
  assert.equal(book.blocks[0].state, 'reorged');
  assert.equal(book.balances.NEXA, 0);
});

test('a sell that would walk the book more than the slippage is refused', () => {
  const bids = [
    { venue: 'a', bidBtc: 1e-8, size: 10 },
    { venue: 'b', bidBtc: 0.9e-8, size: 1000 },
  ];
  assert.equal(chooseVenue(bids, 50, 0.01), undefined);
  const ok = chooseVenue(bids, 10, 0.01);
  assert.ok(ok);
  assert.equal(ok!.venue, 'a');
  assert.equal(ok!.btcOut, 10 * 1e-8);
});

test('sold coins withdraw to the deposit address and then resupply', () => {
  const book = emptyBook();
  onBlockFound(book, { id: 'b2', tag: 'NEXA', reward: 100 });
  const choice = { venue: 'a', bidBtc: 1e-8, coins: 100, btcOut: 0.000001 };
  markSelling(book, 'NEXA', choice);
  assert.equal(book.blocks[0].state, 'selling');
  markSold(book, 'NEXA', choice.btcOut, choice.coins);
  assert.equal(book.blocks[0].state, 'sold');
  assert.equal(book.btcOnExchange, 0.000001);
  markWithdrawing(book, 0.000001, 'nh-deposit');
  assert.equal(book.blocks[0].state, 'withdrawing');
  assert.equal(book.inFlightBtc, 0.000001);
  markResupplied(book, 0.000001);
  assert.equal(book.blocks[0].state, 'resupplied');
  assert.equal(book.inFlightBtc, 0);
});
