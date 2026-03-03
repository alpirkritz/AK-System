/** @type {import('next').NextConfig} */
const path = require('path')
const os = require('os')

// Local paths for all build artefacts – Google Drive does not support inode
// snapshots so webpack's PackFileCacheStrategy keeps failing there.
const TMP_DIR   = path.join(os.tmpdir(), 'ak-system-next')
const CACHE_DIR = path.join(os.tmpdir(), 'ak-system-webpack-cache')

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ak-system/types', '@ak-system/api', '@ak-system/database'],
  experimental: { serverComponentsExternalPackages: ['better-sqlite3', 'bindings'] },
  distDir: TMP_DIR,
  webpack: (config, { isServer }) => {
    // Store webpack's persistent cache in /tmp.
    // Disable snapshot-based validation entirely – Google Drive returns
    // unreliable mtimes/inodes, causing PackFileCacheStrategy to fail and
    // the cache to be ignored. The file watcher (poll: 3000ms) still detects
    // source changes and triggers incremental HMR compilation.
    config.cache = {
      type: 'filesystem',
      cacheDirectory: CACHE_DIR,
      buildDependencies: { config: [__filename] },
    }
    config.snapshot = {
      managedPaths: [],
      immutablePaths: [],
      module:                 { hash: false, timestamp: false },
      resolve:                { hash: false, timestamp: false },
      resolveBuildDependencies: { hash: false, timestamp: false },
      buildDependencies:      { hash: false, timestamp: false },
    }
    if (isServer) {
      const prev = config.externals
      const nativeExternals = (ctx, cb) => {
        if (
          ctx.request === 'better-sqlite3' ||
          ctx.request === 'bindings' ||
          ctx.request === 'child_process' ||
          ctx.request === 'fs' ||
          ctx.request === 'path' ||
          ctx.request === 'os' ||
          ctx.request === 'util'
        ) {
          return cb(null, `commonjs ${ctx.request}`)
        }
        if (typeof prev === 'function') return prev(ctx, cb)
        cb()
      }
      config.externals = Array.isArray(prev) ? [...prev, nativeExternals] : [nativeExternals]
    }
    if (!isServer) {
      // Prevent webpack from bundling Node.js built-ins for the client.
      // These appear transitively via transpilePackages: ['@ak-system/api'].
      config.resolve.fallback = {
        ...config.resolve.fallback,
        child_process: false,
        fs: false,
        path: false,
        util: false,
        os: false,
      }
    }
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/node_modules'],
      poll: 3000,
    }
    return config
  },
}

module.exports = nextConfig
