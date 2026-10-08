// Vercel function entry. The real code is bundled by `pnpm build:vercel` (esbuild) into dist/vercel.js
// during the Vercel build step; this file exists so Vercel's pre-build function discovery finds it.
export { default } from "../dist/vercel.js";
