/**
 * One coin, one VM, official source, fee 0, maturity 0.
 * This module plans and checks. It does not clone or boot unless execute() is called with LIVE_POOLS=1.
 */

export interface PoolConfig {
  tag: string;
  fee: number;
  maturity: number;
  payoutThreshold: number;
  walletAddress: string;
  daemonEndpoint: string;
  sourceRepo: string;
  sourceRevision: string;
  buildCommand: string;
}

export interface HostCapacity {
  canFit: boolean;
  reason?: string;
}

export interface RentQuote {
  provider: string;
  usdPerDay: number;
  address?: string;
}

export interface VmPlan {
  tag: string;
  host: string;
  rented: boolean;
  config: PoolConfig;
  log: string[];
}

export class PoolConfigError extends Error {}

export function assertPoolConfig(config: PoolConfig): void {
  if (config.fee !== 0) throw new PoolConfigError(`${config.tag} fee must be 0, got ${config.fee}`);
  if (config.maturity !== 0) throw new PoolConfigError(`${config.tag} maturity must be 0, got ${config.maturity}`);
  if (config.payoutThreshold !== 0) throw new PoolConfigError(`${config.tag} payout threshold must be 0`);
  if (!config.walletAddress) throw new PoolConfigError(`${config.tag} missing operator wallet`);
  if (!config.daemonEndpoint) throw new PoolConfigError(`${config.tag} pool must talk to a local daemon`);
  if (!config.sourceRepo || !config.sourceRevision) throw new PoolConfigError(`${config.tag} source repo and revision must be pinned`);
  if (!config.buildCommand) throw new PoolConfigError(`${config.tag} missing build command`);
}

export interface PlanRequest {
  config: PoolConfig;
  local: HostCapacity;
  rent?: RentQuote;
  /** Refuses a rental at or above this daily price. */
  rentCapUsd: number;
}

/**
 * Decide where the VM goes. Renting past the cap is a logged refusal, not a silent purchase.
 * The returned plan contains no NiceHash or exchange keys.
 */
export function planVm(req: PlanRequest): VmPlan {
  assertPoolConfig(req.config);
  const log: string[] = [];
  if (req.local.canFit) {
    log.push(`local VM for ${req.config.tag} at ${req.config.sourceRevision}`);
    return { tag: req.config.tag, host: 'local', rented: false, config: req.config, log };
  }
  log.push(`local refused: ${req.local.reason || 'no capacity'}`);
  if (!req.rent) {
    throw new PoolConfigError(`${req.config.tag} needs a machine and no rent quote was given`);
  }
  if (req.rent.usdPerDay > req.rentCapUsd) {
    log.push(`rent refused: ${req.rent.provider} $${req.rent.usdPerDay}/day exceeds cap $${req.rentCapUsd}`);
    throw new PoolConfigError(log[log.length - 1]);
  }
  log.push(`rent ${req.rent.provider} $${req.rent.usdPerDay}/day for ${req.config.tag}`);
  return {
    tag: req.config.tag,
    host: req.rent.address || req.rent.provider,
    rented: true,
    config: req.config,
    log,
  };
}

export interface BuildStep {
  cmd: string;
  cwd: string;
}

/** Commands the executor would run. Tests inspect these and do not shell out. */
export function buildSteps(plan: VmPlan, workdir: string): BuildStep[] {
  const dir = `${workdir}/${plan.tag}`;
  return [
    { cwd: workdir, cmd: `git clone ${plan.config.sourceRepo} ${dir}` },
    { cwd: dir, cmd: `git checkout ${plan.config.sourceRevision}` },
    { cwd: dir, cmd: plan.config.buildCommand },
  ];
}

export interface Executor {
  run(step: BuildStep): Promise<void>;
}

/** Refuses to touch a machine unless LIVE_POOLS=1. */
export async function execute(plan: VmPlan, workdir: string, exec: Executor, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.LIVE_POOLS !== '1') {
    throw new Error(`refusing to build ${plan.tag}: set LIVE_POOLS=1`);
  }
  for (const step of buildSteps(plan, workdir)) await exec.run(step);
}

export function readyForVm(cyclesAboveGate: number, required: number): boolean {
  return cyclesAboveGate >= required;
}
