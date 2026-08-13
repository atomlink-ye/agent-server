import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@atomlink-ye/agent-server'],
  experimental: {
    extensionAlias: {
      '.js': ['.js', '.ts'],
    },
  },
};

export default nextConfig;
