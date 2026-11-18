// Writes each built-in topology's JSON twin from its YAML file, through the
// formats module: YAML read to the model, the model written as JSON. Run it
// after editing a YAML file (npm run topologies -w packages/core); a test
// fails while a twin differs from what this writes.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTopologyText, writeTopologyText } from "../dist/formats/index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "topologies");
for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
  const read = readTopologyText(readFileSync(join(dir, file), "utf-8"), { filename: file });
  if (read.warnings.length) {
    console.error(`${file}:\n${read.warnings.map((w) => `  ${w.path}: ${w.message}`).join("\n")}`);
    process.exitCode = 1;
  }
  const twin = file.replace(/\.yaml$/, ".json");
  writeFileSync(join(dir, twin), writeTopologyText(read.topology, { syntax: "json" }).text);
  console.log(`${file} -> ${twin}`);
}
