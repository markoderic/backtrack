// Builds the sandboxed PowerPoint renderer: src/pptx-renderer/main.ts -> public/pptx-renderer/render.js.
// The output is committed, so the site does not depend on this running during a deploy.
// Run it again after changing main.ts or updating pptx-preview: npm run build:pptx
import { build } from "esbuild";

await build({
  entryPoints: ["src/pptx-renderer/main.ts"],
  outfile: "public/pptx-renderer/render.js",
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  legalComments: "eof",
  logLevel: "warning",
});
