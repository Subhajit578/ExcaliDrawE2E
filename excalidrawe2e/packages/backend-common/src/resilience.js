/**
 * Keeping a sick dependency from taking the whole process with it.
 *
 * Written in plain JavaScript on purpose: this package is exported as raw
 * source and the compiled backends `require()` it, so Node parses this file
 * itself and will not strip type annotations. Types live in resilience.d.ts.
 *
 * Three pieces, which only work together:
 *
 *   a timeout      bounds how long one caller waits
 *   a limiter      bounds how many callers wait at once
 *   a breaker      stops calling at all once the dependency is clearly unwell
 *
 * A timeout alone is not enough. If a database takes 30s and requests arrive
 * faster than that, every one of them still queues; the timeout frees each
 * caller but the pile keeps growing. The limiter is what caps the pile, and
 * the breaker is what stops rebuilding it every time the window reopens.
 */

/** Breaker states. Exported so callers can report them. */
const CLOSED = "closed";     // all good, calls pass through
const OPEN = "open";         // failing, calls rejected without being attempted
const HALF_OPEN = "half-open"; // probing, a few calls allowed through to test

class DependencyError extends Error {
  constructor(message, code, dependency) {
    super(message);
    this.name = "DependencyError";
    this.code = code;           // "open" | "timeout" | "overloaded"
    this.dependency = dependency;
  }
}

/**
 * Reject a promise's *caller* after `ms`.
 *
 * Worth being honest about what this does not do: it does not cancel the
 * work. A Prisma query raced out here keeps running on the server and keeps
 * holding its pooled connection until it finishes. What this buys is that the
 * caller stops waiting and the limiter's slot is released, so one slow query
 * stops being thirty slow requests.
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new DependencyError(`${label} timed out after ${ms}ms`, "timeout", label)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Cap how many calls may be in flight to one dependency, and how many may
 * wait for a slot.
 *
 * The queue limit is the important half. An unbounded queue turns a slow
 * dependency into unbounded memory and a request that is answered long after
 * whoever asked has given up. Past the limit, callers are refused at once,
 * which is a worse answer delivered sooner - and that is the trade being
 * made deliberately.
 */
function createLimiter(name, concurrency, queueLimit) {
  let active = 0;
  const waiting = [];

  function release() {
    active--;
    const next = waiting.shift();
    if (next) {
      active++;
      next();
    }
  }

  return {
    get active() { return active; },
    get queued() { return waiting.length; },
    async run(fn) {
      if (active >= concurrency) {
        if (waiting.length >= queueLimit) {
          throw new DependencyError(
            `${name} is overloaded (${active} in flight, ${waiting.length} queued)`,
            "overloaded",
            name
          );
        }
        await new Promise((resolve) => waiting.push(resolve));
      } else {
        active++;
      }
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

/**
 * A circuit breaker.
 *
 * Counts failures over a rolling window of recent calls. A call that merely
 * takes too long counts as a failure too - a dependency answering every
 * request in nine seconds is not healthy, and waiting for it to start
 * erroring before reacting means the damage is already done.
 *
 * Once tripped it rejects immediately for `openMs`, then lets a small number
 * of trial calls through. Those decide: all succeeding closes it, one failing
 * opens it again for another interval. That is what keeps a flapping
 * dependency from being hammered by every request the moment it twitches.
 */
function createBreaker(options) {
  const name = options.name;
  const windowSize = options.windowSize || 20;
  const failureThreshold = options.failureThreshold || 0.5;
  const minimumCalls = options.minimumCalls || 5;
  const slowCallMs = options.slowCallMs || 3000;
  const openMs = options.openMs || 10000;
  const halfOpenTrials = options.halfOpenTrials || 3;
  const onStateChange = options.onStateChange || (() => {});

  let state = CLOSED;
  let results = [];        // recent outcomes, true = bad
  let openedAt = 0;
  let trialsLeft = 0;
  let trialFailures = 0;

  function moveTo(next) {
    if (state === next) return;
    const previous = state;
    state = next;
    if (next === OPEN) openedAt = Date.now();
    if (next === HALF_OPEN) { trialsLeft = halfOpenTrials; trialFailures = 0; }
    if (next === CLOSED) results = [];
    onStateChange(previous, next, name);
  }

  function record(bad) {
    results.push(bad);
    if (results.length > windowSize) results.shift();
    if (state !== CLOSED) return;
    if (results.length < minimumCalls) return;
    const failures = results.filter(Boolean).length;
    if (failures / results.length >= failureThreshold) moveTo(OPEN);
  }

  return {
    get state() { return state; },
    get snapshot() {
      return {
        name,
        state,
        recentCalls: results.length,
        recentFailures: results.filter(Boolean).length,
      };
    },
    async run(fn) {
      if (state === OPEN) {
        if (Date.now() - openedAt < openMs) {
          throw new DependencyError(`${name} is unavailable`, "open", name);
        }
        moveTo(HALF_OPEN);
      }
      if (state === HALF_OPEN && trialsLeft <= 0) {
        throw new DependencyError(`${name} is unavailable`, "open", name);
      }
      if (state === HALF_OPEN) trialsLeft--;

      const started = Date.now();
      try {
        const value = await fn();
        const slow = Date.now() - started > slowCallMs;
        if (state === HALF_OPEN) {
          if (slow) { moveTo(OPEN); }
          else if (trialsLeft === 0 && trialFailures === 0) { moveTo(CLOSED); }
        } else {
          record(slow);
        }
        return value;
      } catch (err) {
        // a rejection this breaker produced is not evidence about the
        // dependency - counting it would keep the circuit open forever
        if (err instanceof DependencyError && err.code === "open") throw err;
        if (state === HALF_OPEN) { trialFailures++; moveTo(OPEN); }
        else record(true);
        throw err;
      }
    },
  };
}

/**
 * The three composed, in the order that matters.
 *
 * Breaker outermost, so a tripped circuit costs nothing - no slot taken, no
 * timer armed. Then the limiter, so only a bounded number of calls are ever
 * in flight. The timeout innermost, wrapping the actual work.
 */
function createGuard(options) {
  const breaker = createBreaker(options);
  const limiter = createLimiter(options.name, options.concurrency || 10, options.queueLimit || 100);
  const timeoutMs = options.timeoutMs || 5000;

  return {
    breaker,
    limiter,
    get snapshot() {
      return { ...breaker.snapshot, active: limiter.active, queued: limiter.queued };
    },
    run(fn) {
      return breaker.run(() => limiter.run(() => withTimeout(fn(), timeoutMs, options.name)));
    },
  };
}

module.exports = {
  CLOSED, OPEN, HALF_OPEN,
  DependencyError,
  withTimeout,
  createLimiter,
  createBreaker,
  createGuard,
};
