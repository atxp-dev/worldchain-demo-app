import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    domains: ['hold-played-liver-twice.trycloudflare.com'],
  },
  allowedDevOrigins: ['*', 'hold-played-liver-twice.trycloudflare.com'], // Add your dev origin here
  reactStrictMode: false,
};

export default nextConfig;
