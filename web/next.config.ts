import type { NextConfig } from 'next';
import path from 'path';
const { backendOrigin } = require('./scripts/backend-origin.cjs');
const backend = backendOrigin();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '..'),
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  async rewrites() {
    return [{ source: '/backend/:path*', destination: `${backend}/:path*` }];
  },
};

export default nextConfig;
