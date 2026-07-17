import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Stripe SDK is server-only; marking it as external keeps it out of the
  // client bundle and avoids Next 16 warnings about Node.js APIs in browser.
  serverExternalPackages: ["stripe"],
};

export default nextConfig;
