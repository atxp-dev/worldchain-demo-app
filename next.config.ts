import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    domains: ['gotta-pictures-powerseller-for.trycloudflare.com'],
  },
  allowedDevOrigins: ['*', 'gotta-pictures-powerseller-for.trycloudflare.com'], // Add your dev origin here
  reactStrictMode: false,
};

export default nextConfig;
