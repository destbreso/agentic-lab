// Writes each built-in topology's JSON twin from its YAML file, through the
// formats module: YAML read to the model, the model written as JSON. Run it
// after editing a YAML file (npm run topologies -w packages/core); a test
// fails while a twin differs from what this writes.
//
// With --yaml it first writes each YAML file again from the model, its header
// comment kept: for a change to the writer itself (its compact form, a tool's
// description), so the files hold what the lab writes. The warnings it prints
// then name the parts that change.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTopologyText, writeTopologyText } from "../dist/formats/index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "topologies");
const rewriteYaml = process.argv.includes("--yaml");

/** The comment lines at the top of a YAML file, without their "# ". */
const headerOf = (text) => {
  const lines = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("#")) break;
    lines.push(line.replace(/^# ?/, ""));
  }
  return lines.join("\n");
};

for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
  const path = join(dir, file);
  const text = readFileSync(path, "utf-8");
  const read = readTopologyText(text, { filename: file });
  if (read.warnings.length) {
    console.error(`${file}:\n${read.warnings.map((w) => `  ${w.path}: ${w.message}`).join("\n")}`);
    if (!rewriteYaml) process.exitCode = 1;
  }
  if (rewriteYaml) {
    writeFileSync(path, writeTopologyText(read.topology, { syntax: "yaml", header: headerOf(text) }).text);
    console.log(`${file} written from the model`);
  }
  const twin = file.replace(/\.yaml$/, ".json");
  writeFileSync(join(dir, twin), writeTopologyText(read.topology, { syntax: "json" }).text);
  console.log(`${file} -> ${twin}`);
}
