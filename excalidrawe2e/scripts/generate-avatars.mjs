/**
 * Build the avatar pool: SVG files on disk, plus the manifest both apps agree on.
 *
 * Run by hand, not by the build:
 *
 *   node scripts/generate-avatars.mjs
 *
 * That is the point. "The pool does not change until a developer changes it"
 * is only true if generating it is a deliberate act - a generative library
 * wired into the build would hand every deploy a different set of faces, and
 * every user's stored avatar id would point at something new.
 *
 * Output is deterministic: the seeds below are fixed, so re-running this
 * overwrites each file with identical bytes. A diff after a plain re-run means
 * DiceBear changed, not that the script is flaky.
 *
 * The generated SVGs are committed. The app therefore has no runtime or
 * build-time dependency on DiceBear at all - @dicebear/* is a devDependency
 * used by this script and nothing else, and api.dicebear.com is never called.
 * Avatars are first-party static files: no third party sees who is signing in,
 * nothing breaks if that service goes down, and each file is immutable and so
 * cacheable forever.
 */

import { createAvatar } from "@dicebear/core";
import * as collection from "@dicebear/collection";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVG_DIR = join(ROOT, "apps/excalidrawfe/public/avatars");
const MANIFEST = join(ROOT, "packages/common/src/avatars.ts");

/** How many faces per style. 6 styles x 12 fills a picker grid without scrolling far. */
const PER_STYLE = 12;

/**
 * The styles, in the order they appear in the picker.
 *
 * `id` is what goes in the database and the URL, so it is kebab-case and
 * stable; `export` is DiceBear's camelCase key, which is an implementation
 * detail of this script. `label` is what a person reads.
 */
const STYLES = [
  { id: "adventurer", export: "adventurer", label: "Adventurer" },
  { id: "notionists", export: "notionists", label: "Notionist" },
  { id: "personas",   export: "personas",   label: "Personas" },
  { id: "pixel-art",  export: "pixelArt",   label: "Pixel Art" },
  { id: "toon-head",  export: "toonHead",   label: "Toon Head" },
  { id: "big-ears",   export: "bigEars",    label: "Big Ears" },
];

/**
 * Two digits, so the files sort the way they are numbered and an id is a
 * fixed shape to validate.
 */
const num = (i) => String(i + 1).padStart(2, "0");

/**
 * No background and no corner radius on purpose.
 *
 * The circle and its tint are the interface's job, which keeps one copy of
 * each face usable on a light dashboard and a dark canvas alike. Baking a
 * background in would freeze a colour decision into immutable files.
 *
 * Note for anyone rendering these: each file contains `<mask id="viewboxMask">`,
 * and the id is the same in all 72. That is fine in an `<img>`, where every
 * file is its own document, and it is how the app uses them. Inline several
 * into one HTML page and the ids collide - every avatar resolves the mask to
 * whichever one came first, and styles with a larger viewBox get clipped to
 * the corner. DiceBear's `randomizeIds` option exists for that case; it is
 * deliberately not used here, because it would make the output non-reproducible.
 */
function render(style, seed) {
  return createAvatar(style, {
    seed,
    size: 160,
    backgroundColor: ["transparent"],
  }).toString();
}

async function main() {
  // wiped rather than merged into: a style removed from STYLES, or a smaller
  // PER_STYLE, must leave no orphan file behind that the manifest no longer
  // lists but the picker could still be pointed at
  await rm(SVG_DIR, { recursive: true, force: true });

  const manifest = [];
  let bytes = 0;

  for (const style of STYLES) {
    const impl = collection[style.export];
    if (!impl) throw new Error(`@dicebear/collection has no style "${style.export}"`);

    await mkdir(join(SVG_DIR, style.id), { recursive: true });

    const ids = [];
    for (let i = 0; i < PER_STYLE; i++) {
      // the seed includes the style id, so the same number in two styles is
      // two different faces rather than the same person drawn twice
      const svg = render(impl, `${style.id}-${num(i)}`);
      await writeFile(join(SVG_DIR, style.id, `${num(i)}.svg`), svg, "utf8");
      ids.push(`${style.id}/${num(i)}`);
      bytes += Buffer.byteLength(svg);
    }

    // `export` stays here: the manifest describes the pool to the picker,
    // not which DiceBear package drew it
    manifest.push({ id: style.id, label: style.label, ids });
    console.log(`  ${style.label.padEnd(11)} ${PER_STYLE} avatars`);
  }

  await writeFile(MANIFEST, renderManifest(manifest), "utf8");

  const total = manifest.length * PER_STYLE;
  console.log(`\n${total} avatars, ${(bytes / 1024).toFixed(0)}KB of SVG`);
  console.log(`  ${SVG_DIR}`);
  console.log(`  ${MANIFEST}`);
}

/**
 * Write the manifest as plain JavaScript in a .ts file.
 *
 * Not a stylistic choice: `@repo/common` is exported as raw source, and the
 * compiled backend `require()`s it, so Node parses this file itself. Node 22
 * does not strip types, which means a single type annotation here is a
 * SyntaxError at server start. Data only, no annotations - the same constraint
 * types.ts already documents.
 */
function renderManifest(styles) {
  const body = styles
    .map(
      (s) => `  {
    id: "${s.id}",
    label: "${s.label}",
    ids: [
${s.ids.map((id) => `      "${id}",`).join("\n")}
    ],
  },`
    )
    .join("\n");

  return `// GENERATED by scripts/generate-avatars.mjs - do not edit by hand.
//
// The avatar pool: every id a user's \`photo\` column is allowed to hold, and
// the order the picker shows them in. An id is "<style>/<nn>", which is also
// the path of its SVG under the frontend's /avatars.
//
// Plain JavaScript, deliberately. This file is loaded as source at runtime by
// the backend, and Node 22 does not strip types - one annotation here and the
// server will not start.

export const AVATAR_STYLES = [
${body}
];

/** Every id in one flat list, for membership checks and random picks. */
export const AVATAR_IDS = AVATAR_STYLES.flatMap((style) => style.ids);
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
