/**
 * Names for one-click guest accounts.
 *
 * A guest never chooses a username, so the server invents one. It has to be
 * unique (it is a unique column and the thing people sign in with), readable
 * enough to recognise in a room, and cheap to produce - a board full of
 * "user_8f2a9c" is worse than useless when two of them are drawing at once.
 */

const ADJECTIVES = [
  "brave", "clever", "cosmic", "dapper", "eager", "fuzzy", "gentle", "happy",
  "jolly", "keen", "lucky", "mellow", "nimble", "plucky", "quiet", "rapid",
  "swift", "tidy", "witty", "zesty", "bold", "curious", "dreamy", "frosty",
  "glowing", "humble", "ivory", "jazzy", "kind", "lively",
];

const ANIMALS = [
  "otter", "panda", "falcon", "lynx", "heron", "badger", "marmot", "puffin",
  "gecko", "narwhal", "ocelot", "quokka", "raven", "seal", "tapir", "urchin",
  "vole", "walrus", "yak", "zebra", "bison", "crane", "dingo", "egret",
  "ferret", "gibbon", "ibis", "jackal", "koala", "lemur",
];

/**
 * How many attempts before giving up.
 *
 * Each attempt is a database round trip on collision, so this is a ceiling on
 * the damage a very full namespace can do to one request rather than a number
 * anyone should ever reach.
 */
export const MAX_NAME_ATTEMPTS = 5;

/**
 * A candidate like "swift-otter-4821".
 *
 * The number is what makes collisions rare rather than the word pair: 30x30
 * pairs is only 900 combinations, which would start colliding almost at once,
 * while four digits takes the space to nine million. The suffix widens with
 * each retry, so a namespace that has genuinely filled up degrades into longer
 * names instead of failing.
 *
 * Uniqueness is still decided by the database. Checking first and inserting
 * after would be a race between the check and the insert; the unique
 * constraint is the only thing that can actually settle it, so the caller
 * retries on a collision rather than trying to avoid one.
 */
export function guestUsername(attempt = 0): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const digits = 4 + attempt;
  const max = 10 ** digits;
  const suffix = Math.floor(Math.random() * max)
    .toString()
    .padStart(digits, "0");
  return `${adjective}-${animal}-${suffix}`;
}
