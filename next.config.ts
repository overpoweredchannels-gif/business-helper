import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output ONLY for desktop builds (slice S0): `next build`
  // produces .next/standalone/server.js, a self-contained Node server the
  // Electron main process spawns. It must stay off on Vercel: standalone
  // output does not produce .next/next-server.js.nft.json, and Vercel's
  // onBuildComplete step fails with ENOENT trying to read it, so every
  // Vercel deployment errors after a successful compile. Vercel builds
  // run without AANKH_DESKTOP_BUILD set, so they get the default output;
  // desktop builds set it via the desktop:build script.
  output: process.env.AANKH_DESKTOP_BUILD === "1" ? "standalone" : undefined,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=(self)",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000",
          },
          {
            key: "Content-Security-Policy",
            value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
