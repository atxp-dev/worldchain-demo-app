import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    domains: ['characteristic-mathematics-rapid-deck.trycloudflare.com'],
  },
  allowedDevOrigins: ['*', 'characteristic-mathematics-rapid-deck.trycloudflare.com'], // Add your dev origin here
  reactStrictMode: false,
};

export default nextConfig;
