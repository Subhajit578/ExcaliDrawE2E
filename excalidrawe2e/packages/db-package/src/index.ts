import { PrismaClient, Prisma } from "@prisma/client";
import { createGuard } from "@repo/backend-common/resilience";

/**
 * The database client, with a circuit breaker in front of every query.
 *
 * Postgres is the dependency the whole application leans on: every route and
 * every drawing action ends up here. It is also the one most able to be slow
 * rather than down - Neon suspends when idle, and a cold start is seconds of
 * nothing. Without a bound on that, requests queue, the connection pool
 * empties, and the queue keeps growing because new requests arrive faster
 * than old ones drain. Endpoints needing no data get slow too, because they
 * are stuck behind the same exhausted pool.
 *
 * Applied as a client extension rather than at the call sites: there are
 * dozens of those across two services, and one of them forgetting the
 * wrapper is exactly the hole this is meant to close.
 *
 * NOTE: this file is exported as raw source and `require()`d by the compiled
 * backends, so Node parses it directly and will not strip type annotations.
 * Keep it valid JavaScript - types go in JSDoc, as below.
 */

// Tunables, read once. Written out rather than looped through a helper:
// this file is parsed by Node as-is, so it cannot carry type annotations,
// and TypeScript ignores JSDoc types in a .ts file - so a parameterised
// helper here is either untyped or unparseable. Five explicit lines are
// neither.
const TIMEOUT_MS = Number(process.env.DB_TIMEOUT_MS) > 0 ? Number(process.env.DB_TIMEOUT_MS) : 8000;
const CONCURRENCY = Number(process.env.DB_CONCURRENCY) > 0 ? Number(process.env.DB_CONCURRENCY) : 10;
const QUEUE_LIMIT = Number(process.env.DB_QUEUE_LIMIT) > 0 ? Number(process.env.DB_QUEUE_LIMIT) : 50;
const SLOW_MS = Number(process.env.DB_SLOW_MS) > 0 ? Number(process.env.DB_SLOW_MS) : 4000;
const OPEN_MS = Number(process.env.DB_OPEN_MS) > 0 ? Number(process.env.DB_OPEN_MS) : 10000;
export const dbGuard = createGuard({
  name: "postgres",

  // Long enough for a Neon cold start to succeed, short enough that a caller
  // is not holding a socket open for a minute. This frees the *caller*; the
  // query keeps running and keeps its pooled connection until it finishes,
  // which is why the concurrency cap below matters as much.
  timeoutMs: TIMEOUT_MS,

  // Roughly the pool size. Past this, callers wait; past the queue limit they
  // are refused at once. An unbounded queue is how a slow dependency becomes
  // unbounded memory and answers nobody is waiting for any more.
  concurrency: CONCURRENCY,
  queueLimit: QUEUE_LIMIT,

  // A query slower than this counts against the circuit even when it
  // succeeds. Waiting for an unhealthy dependency to start erroring before
  // reacting means reacting after the damage.
  slowCallMs: SLOW_MS,

  failureThreshold: 0.5,
  minimumCalls: 5,
  openMs: OPEN_MS,
  halfOpenTrials: 3,

  onStateChange: (from, to, name) => {
    console.warn(`[resilience] ${name}: ${from} -> ${to}`);
  },
});

const base = new PrismaClient();

export const prismaClient = base.$extends({
  query: {
    async $allOperations({ args, query }) {
      return dbGuard.run(() => query(args));
    },
  },
});

/**
 * Re-exported for callers that build a parameterised raw statement.
 *
 * `Prisma.sql` and `Prisma.join` are how a batched write gets a variable
 * number of rows into one statement without concatenating strings - every
 * value stays a bound parameter, so the row count can vary and the query
 * still cannot be injected into.
 */
export { Prisma };
