import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  /* Las rutas públicas las controla Vite porque este proyecto usa Vinext. */
};

export default nextConfig;
