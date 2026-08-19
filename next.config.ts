import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The harness runs this app under `next dev` (only the dev server mounts `/_next/mcp`), and a
  // vision evaluator faithfully reports the dev indicator as a UI defect. Hiding it keeps
  // dev-only chrome out of the screenshots; compile and runtime errors still surface.
  devIndicators: false,
};

export default nextConfig;
