import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Allow `RAUCHAT_DIST=.next-build npm run build` while a dev server holds
  // .next — building into the live dev server's distDir corrupts both.
  distDir: process.env.RAUCHAT_DIST || ".next",
  // This repository can live below a home-directory lockfile. Pinning the
  // trace root keeps production output inside Rauchat instead of allowing
  // Next.js to infer an unrelated ancestor workspace.
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
