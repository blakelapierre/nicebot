/**
 * Blocks move found -> credited immediately (maturity 0) -> selling -> sold -> withdrawing -> resupplied.
 * A reorg from credited reverses the balance. Nothing is frozen.
 */

export type BlockState = 'found' | 'credited' | 'reorged' | 'selling' | 'sold' | 'withdrawing' | 'resupplied';

export interface TrackedBlock {
  id: string;
  tag: string;
  reward: number;
  state: BlockState;
  note?: string;
}

export interface VenueBid {
  venue: string;
  /** BTC per coin at this size. */
  bidBtc: number;
  /** Largest coin size this bid can fill. */
  size: number;
}

export interface SellChoice {
  venue: string;
  bidBtc: number;
  coins: number;
  btcOut: number;
}

export interface WalletBook {
  blocks: TrackedBlock[];
  /** Spendable coin, credited and not yet sold. */
  balances: Record<string, number>;
  /** BTC sitting on an exchange after a fill, not yet withdrawn. */
  btcOnExchange: number;
  /** BTC sent to NiceHash and not yet credited there. */
  inFlightBtc: number;
}

export function emptyBook(): WalletBook {
  return { blocks: [], balances: {}, btcOnExchange: 0, inFlightBtc: 0 };
}

export function onBlockFound(book: WalletBook, block: { id: string; tag: string; reward: number }): TrackedBlock {
  const existing = book.blocks.find(b => b.id === block.id);
  if (existing) return existing;
  const row: TrackedBlock = { id: block.id, tag: block.tag, reward: block.reward, state: 'credited' };
  book.blocks.push(row);
  book.balances[block.tag] = (book.balances[block.tag] ?? 0) + block.reward;
  return row;
}

export function onReorg(book: WalletBook, id: string): TrackedBlock | undefined {
  const row = book.blocks.find(b => b.id === id);
  if (!row) return undefined;
  if (row.state === 'credited') {
    book.balances[row.tag] = (book.balances[row.tag] ?? 0) - row.reward;
  }
  row.state = 'reorged';
  row.note = 'daemon dropped the block';
  return row;
}

/**
 * Best bid that can absorb `coins` without walking past maxSlippage from the top bid.
 * Returns undefined if the only way out is to smash an empty book.
 */
export function chooseVenue(bids: VenueBid[], coins: number, maxSlippage: number): SellChoice | undefined {
  if (!(coins > 0)) return undefined;
  const ranked = [...bids].filter(b => b.size > 0 && b.bidBtc > 0).sort((a, b) => b.bidBtc - a.bidBtc);
  if (ranked.length === 0) return undefined;
  const top = ranked[0].bidBtc;
  const floor = top * (1 - maxSlippage);
  let left = coins;
  let btc = 0;
  let used = 0;
  let venue = ranked[0].venue;
  let worst = top;
  for (const bid of ranked) {
    if (bid.bidBtc < floor) break;
    const take = Math.min(left, bid.size);
    if (!(take > 0)) continue;
    btc += take * bid.bidBtc;
    used += take;
    left -= take;
    worst = bid.bidBtc;
    if (left <= 0) break;
  }
  if (left > 0) return undefined;
  return { venue, bidBtc: worst, coins: used, btcOut: btc };
}

export function markSelling(book: WalletBook, tag: string, choice: SellChoice): void {
  const rows = book.blocks.filter(b => b.tag === tag && b.state === 'credited');
  let left = choice.coins;
  for (const row of rows) {
    if (left <= 0) break;
    row.state = 'selling';
    row.note = choice.venue;
    left -= row.reward;
  }
}

export function markSold(book: WalletBook, tag: string, btcOut: number, coins: number): void {
  for (const row of book.blocks) {
    if (row.tag === tag && row.state === 'selling') row.state = 'sold';
  }
  book.balances[tag] = (book.balances[tag] ?? 0) - coins;
  book.btcOnExchange += btcOut;
}

export function markWithdrawing(book: WalletBook, amount: number, depositAddress: string): number {
  const take = Math.min(amount, book.btcOnExchange);
  book.btcOnExchange -= take;
  book.inFlightBtc += take;
  for (const row of book.blocks) {
    if (row.state === 'sold') {
      row.state = 'withdrawing';
      row.note = depositAddress;
    }
  }
  return take;
}

export function markResupplied(book: WalletBook, amount: number): void {
  const take = Math.min(amount, book.inFlightBtc);
  book.inFlightBtc -= take;
  for (const row of book.blocks) {
    if (row.state === 'withdrawing') row.state = 'resupplied';
  }
}
