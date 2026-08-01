import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow `RAUCHAT_DIST=.next-build npm run build` while a dev server holds
  // .next — building into the live dev server's distDir corrupts both.
  distDir: process.env.RAUCHAT_DIST || ".next",
};

export default nextConfig;
