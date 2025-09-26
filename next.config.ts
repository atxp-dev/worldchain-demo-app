import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    domains: ['f9108ab35d10.ngrok-free.app'],
  },
  allowedDevOrigins: ['*', 'f9108ab35d10.ngrok-free.app'], // Add your dev origin here
  reactStrictMode: false,
};

export default nextConfig;
