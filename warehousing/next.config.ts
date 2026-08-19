import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  // This app lives in a subdirectory of the afs-admin git repo (its own
  // package.json/lockfile, deployed as a separate Vercel project with Root
  // Directory=warehousing) — pin the Turbopack root explicitly so it
  // doesn't get inferred as the parent repo just because a lockfile also
  // exists up there.
  turbopack: {
    root: path.join(__dirname),
  },
}

export default nextConfig
