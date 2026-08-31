import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: 'tsconfig.build.json',
  },
  async redirects() {
    return [
      {
        source: '/utility',
        destination: '/utilities/bills',
        permanent: false,
      },
    ]
  },
}

export default nextConfig
