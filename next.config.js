/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Handle native modules only on the server side
    if (!isServer) {
      // Ignore native modules and their dependencies in client-side builds
      config.resolve.fallback = {
        ...config.resolve.fallback,
        "tree-sitter": false,
        "tree-sitter-javascript": false,
        "tree-sitter-typescript": false,
        "node:fs": false,
        "node:path": false,
      };

      // Explicitly ignore .node files in client builds
      config.module.rules.push({
        test: /\.node$/,
        loader: "null-loader",
      });
    }

    return config;
  },
  // Explicitly mark which files are allowed to be loaded
  experimental: {
    serverComponentsExternalPackages: [
      "tree-sitter",
      "tree-sitter-javascript",
      "tree-sitter-typescript",
    ],
  },
};

module.exports = nextConfig;
