import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // postgres and ffmpeg-static must not be bundled by webpack
  serverExternalPackages: ['postgres', 'ffmpeg-static'],
};

export default nextConfig;
