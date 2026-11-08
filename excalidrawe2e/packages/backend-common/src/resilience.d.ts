/** Types for resilience.js, which is plain JavaScript by necessity. */

export type BreakerState = "closed" | "open" | "half-open";

export declare class DependencyError extends Error {
  /** why the call never reached the dependency, or did not finish */
  code: "open" | "timeout" | "overloaded";
  dependency: string;
}

export interface GuardOptions {
  /** used in errors and logs */
  name: string;
  /** reject the caller after this long; does not cancel the work */
  timeoutMs?: number;
  /** calls allowed in flight at once */
  concurrency?: number;
  /** callers allowed to wait for a slot before being refused outright */
  queueLimit?: number;
  /** a call slower than this counts as a failure even when it succeeds */
  slowCallMs?: number;
  /** fraction of the recent window that must fail to trip the breaker */
  failureThreshold?: number;
  /** calls to observe before the threshold means anything */
  minimumCalls?: number;
  windowSize?: number;
  /** how long to reject everything before probing again */
  openMs?: number;
  /** probes allowed while half-open */
  halfOpenTrials?: number;
  onStateChange?: (from: BreakerState, to: BreakerState, name: string) => void;
}

export interface Guard {
  run<T>(fn: () => Promise<T>): Promise<T>;
  readonly snapshot: {
    name: string;
    state: BreakerState;
    recentCalls: number;
    recentFailures: number;
    active: number;
    queued: number;
  };
}

export declare function createGuard(options: GuardOptions): Guard;
export declare function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T>;
export declare const CLOSED: "closed";
export declare const OPEN: "open";
export declare const HALF_OPEN: "half-open";
