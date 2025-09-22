import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    domains: ['claims-notebooks-commission-presenting.trycloudflare.com'],
  },
  allowedDevOrigins: ['*', 'claims-notebooks-commission-presenting.trycloudflare.com'], // Add your dev origin here
  reactStrictMode: false,
};

export default nextConfig;
