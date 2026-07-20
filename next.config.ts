import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
