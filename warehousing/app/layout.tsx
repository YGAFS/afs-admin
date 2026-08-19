import type { Metadata } from 'next'
import './globals.css'
import Providers from './providers'
import ConditionalLayout from './components/ConditionalLayout'

export const metadata: Metadata = { title: 'AFS Warehousing' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="flex h-screen bg-gray-50 overflow-hidden">
        <Providers>
          <ConditionalLayout>
            {children}
          </ConditionalLayout>
        </Providers>
      </body>
    </html>
  )
}
