import { prismaClient } from "@repo/db-package/client";

/**
 * Removing guest accounts whose session has run out.
 *
 * A guest is held by its token and nothing else, so once that token expires
 * the account is unreachable: no password, no email, no way back in. Leaving
 * the row behind would grow the table forever with accounts nobody can use -
 * and one of them holds a username someone else could have had.
 *
 * What goes and what stays is the whole point of this file:
 *
 *   goes   the account, its memberships, and the rooms it created, with
 *          everything drawn in them - those rooms die with their only owner
 *   stays  anything it drew on someone else's board, and any image it
 *          uploaded that another board still shows
 *
 * The second half is why Shape.userId and File.userId are nullable with
 * onDelete: SetNull. A shape belongs to its room rather than to its author,
 * and edit rights come from being in the room, so dropping the authorship
 * leaves the work in place and still editable by everyone who can see it.
 */

/**
 * How long a guest account lives, in days.
 *
 * Must match the token lifetime: the token is the only way into the account,
 * so sweeping earlier would delete accounts people are still using, and later
 * would leave unreachable rows lying around. Exported so the two cannot drift.
 */
export const GUEST_TTL_DAYS = 15;

/** How often the sweep runs while the process is up. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * A ceiling on one pass.
 *
 * Deleting in batches rather than all at once keeps a long-neglected database
 * from holding transactions open for minutes at a time. Whatever is left over
 * is picked up by the next run.
 */
const BATCH = 200;

export type SweepResult = { accounts: number; rooms: number };

/**
 * Delete every guest whose session has expired. Safe to call at any time, and
 * safe to call twice - it only ever matches rows that are already past due.
 */
export async function sweepExpiredGuests(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - GUEST_TTL_DAYS * 24 * 60 * 60 * 1000);

  const expired = await prismaClient.user.findMany({
    where: { isGuest: true, createdAt: { lt: cutoff } },
    select: { id: true, username: true },
    take: BATCH,
  });
  if (expired.length === 0) return { accounts: 0, rooms: 0 };

  let roomsRemoved = 0;

  for (const guest of expired) {
    // Rooms the guest created. Their only owner is going, and the schema has
    // no concept of transferring ownership, so a board nobody can administer
    // would be left behind - it goes with them.
    const owned = await prismaClient.room.findMany({
      where: { adminId: guest.id },
      select: { id: true },
    });

    // One transaction per guest rather than one for all of them: a failure
    // part-way through leaves whole accounts done or untouched, never an
    // account whose rooms are gone but which still exists.
    await prismaClient.$transaction(async (tx) => {
      for (const room of owned) {
        await tx.shape.deleteMany({ where: { roomId: room.id } });
        await tx.roomMember.deleteMany({ where: { roomId: room.id } });
        await tx.room.delete({ where: { id: room.id } });
      }
      // their seat in other people's rooms; the work they did there stays
      await tx.roomMember.deleteMany({ where: { userId: guest.id } });

      // Shapes and files elsewhere are deliberately not touched. Deleting the
      // user sets their userId to null, which keeps the work and loses only
      // the name attached to it.
      await tx.user.delete({ where: { id: guest.id } });
    });

    roomsRemoved += owned.length;
  }

  console.log(
    `[guests] swept ${expired.length} expired account(s) and ${roomsRemoved} room(s)`
  );
  return { accounts: expired.length, rooms: roomsRemoved };
}

/**
 * Run the sweep now and then periodically.
 *
 * An interval inside the API process, which is the right size for one
 * instance and the wrong one for several: each would run its own copy of the
 * same work. The deletes are idempotent so duplicates are wasteful rather
 * than harmful, but the moment this runs on more than one instance the sweep
 * should move to a scheduled job calling sweepExpiredGuests once.
 *
 * Failures are logged, never thrown: a sweep that cannot reach the database -
 * which on a serverless Postgres is an ordinary cold start - must not take
 * the API down with it.
 */
export function startGuestSweeper() {
  const run = () =>
    sweepExpiredGuests().catch((err) =>
      console.error("[guests] sweep failed:", err)
    );

  // not on the very first tick: startup is busy, and nothing is urgent here
  setTimeout(run, 60_000);
  setInterval(run, SWEEP_INTERVAL_MS).unref?.();
}
