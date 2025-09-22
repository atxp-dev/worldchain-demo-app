import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    domains: ['claims-notebooks-commission-presenting.trycloudflare.com'],
  },
  allowedDevOrigins: ['*'], // Add your dev origin here
  reactStrictMode: false,
};

export default nextConfig;
