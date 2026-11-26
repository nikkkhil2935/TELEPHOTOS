import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  experimental: {
    devtoolSegmentExplorer: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  output: 'standalone',
  transpilePackages: ['motion'],
  webpack: (config, { dev, isServer, webpack }) => {
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }

    if (!isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        crypto: path.resolve(process.cwd(), 'lib/shims/crypto.js'),
        os: path.resolve(process.cwd(), 'lib/shims/os.js'),
        util: path.resolve(process.cwd(), 'lib/shims/util.js'),
        path: require.resolve('path-browserify'),
        buffer: require.resolve('buffer/'),
      };

      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        net: false,
        tls: false,
        stream: false,
        constants: false,
        http: false,
        https: false,
        zlib: false,
        dns: false,
        child_process: false,
      };

      config.plugins = config.plugins || [];
      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
        })
      );
    }

    return config;
  },
};

export default nextConfig;
