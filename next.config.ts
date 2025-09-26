import type { NextConfig } from 'next';

// Extract domain from AUTH_URL environment variable
const getAuthDomain = () => {
  const authUrl = process.env.AUTH_URL;
  if (!authUrl) return null;

  try {
    const url = new URL(authUrl);
    return url.hostname;
  } catch {
    return null;
  }
};

const authDomain = getAuthDomain();
const domains = authDomain ? [authDomain] : [];
const allowedOrigins = authDomain ? ['*', authDomain] : ['*'];

const nextConfig: NextConfig = {
  images: {
    domains,
  },
  allowedDevOrigins: allowedOrigins,
  reactStrictMode: false,
};

export default nextConfig;
