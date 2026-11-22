/** Health of a pool VM. The orchestrator sees metrics, not the VM filesystem. */

import type { PoolConfig } from './builder.ts';

export interface PoolMetrics {
  tag: string;
  host: string;
  revision: string;
  height: number;
  networkHeight: number;
  peers: number;
  hashrate: number;
  fee: number;
  maturity: number;
  blocksFound: number;
}

export class PoolHealthError extends Error {}

export function assertHealthy(metrics: PoolMetrics, config: PoolConfig): void {
  if (metrics.fee !== 0 || config.fee !== 0) throw new PoolHealthError(`${metrics.tag} fee is not 0`);
  if (metrics.maturity !== 0 || config.maturity !== 0) throw new PoolHealthError(`${metrics.tag} maturity is not 0`);
  if (metrics.revision !== config.sourceRevision) {
    throw new PoolHealthError(`${metrics.tag} revision ${metrics.revision} != pinned ${config.sourceRevision}`);
  }
}

export function syncLag(metrics: PoolMetrics): number {
  return metrics.networkHeight - metrics.height;
}
