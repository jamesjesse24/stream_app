/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 14 writes development and production bundles into the same directory
  // by default. Keeping them separate prevents webpack-runtime version skew
  // when `next build` is run while a developer is using `next dev`.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  experimental: {
    esmExternals: true,
  },
  images: {
    domains: ['uhdmovies.vip', 'i.imgur.com', 'image.tmdb.org'],
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    // Handle ES modules
    if (isServer) {
      config.externals = [...config.externals, 'cheerio', 'axios', 'tough-cookie'];
    }
    
    return config;
  },
  env: {
    BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:3001',
    CUSTOM_KEY: process.env.CUSTOM_KEY || 'my-value',
  },
};

export default nextConfig;
