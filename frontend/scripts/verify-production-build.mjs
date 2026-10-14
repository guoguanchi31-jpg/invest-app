import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";


const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");

if (!existsSync(path.join(dist, "index.html"))) {
  throw new Error("Production build is missing dist/index.html");
}
if (existsSync(path.join(dist, "simulator.html"))) {
  throw new Error("Production build unexpectedly contains simulator.html");
}

const files = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory)) {
    const target = path.join(directory, entry);
    if (statSync(target).isDirectory()) walk(target);
    else files.push(target);
  }
};
walk(dist);

for (const file of files) {
  if (/simulator/i.test(path.basename(file))) {
    throw new Error(`Production build contains a simulator chunk: ${file}`);
  }
  if (!/\.(?:html|css|js|json|map)$/i.test(file)) continue;
  const content = readFileSync(file, "utf8");
  if (content.includes("127.0.0.1:7777")) {
    throw new Error(`Production build contains the removed debug endpoint: ${file}`);
  }
}

console.log(`Production build verified (${files.length} files).`);
