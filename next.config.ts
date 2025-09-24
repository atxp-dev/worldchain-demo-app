import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    domains: ['ec4c267c99bf.ngrok-free.app'],
  },
  allowedDevOrigins: ['*', 'ec4c267c99bf.ngrok-free.app'], // Add your dev origin here
  reactStrictMode: false,
};

export default nextConfig;
