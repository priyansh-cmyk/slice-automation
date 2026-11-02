import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 is a native Node.js module — never bundle it
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
