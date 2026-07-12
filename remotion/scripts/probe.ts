/**
 * Print normalized metadata for a media file as JSON.
 *
 * Usage: npx tsx scripts/probe.ts <path-to-video>
 */
import { probeFile } from "./ffbin";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx scripts/probe.ts <path-to-video>");
  process.exit(1);
}

console.log(JSON.stringify(probeFile(file), null, 2));
