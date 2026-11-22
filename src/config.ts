/** Thresholds from docs/SPEC.md section 12. reserveBtc is per deployment. */

export interface BotConfig {
  roiMin: number;
  buyerFee: number;
  maxNetworkFraction: number;
  pauseGraceMs: number;
  repriceBand: number;
  starveForMs: number;
  poolBuildAfter: number;
  maxSlippage: number;
  reserveBtc: number;
  /** Orders smaller than this fraction of the largest filled order are dust. */
  dustFraction: number;
  /** Absolute price step used when the algorithm does not publish one. */
  defaultPriceStep: number;
  orderCreateFeeBtc: number;
}

export const DEFAULTS: BotConfig = {
  roiMin: 1,
  buyerFee: 0.03,
  maxNetworkFraction: 0.10,
  pauseGraceMs: 15 * 60 * 1000,
  repriceBand: 0.01,
  starveForMs: 5 * 60 * 1000,
  poolBuildAfter: 3,
  maxSlippage: 0.01,
  reserveBtc: 0,
  dustFraction: 0.005,
  defaultPriceStep: 0.0001,
  orderCreateFeeBtc: 0.00001,
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const reserve = Number(env.RESERVE_BTC);
  return {
    ...DEFAULTS,
    reserveBtc: Number.isFinite(reserve) ? reserve : DEFAULTS.reserveBtc,
  };
}

export function liveOrdersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LIVE === '1';
}
