import { Inter } from 'next/font/google'
import { OnlineSubtitleSearch } from '@/components/OnlineSubtitleSearch'
import { StreamDebugProbe } from '@/components/StreamDebugProbe'
import { SubtitleSyncControl } from '@/components/SubtitleSyncControl'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'UHD Movies - Anime Streaming',
  description: 'Stream your favorite anime in high quality',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-gray-950 text-white`}>
        <StreamDebugProbe />
        <SubtitleSyncControl />
        <OnlineSubtitleSearch />
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-blue-950">
          {children}
        </div>
      </body>
    </html>
  )
}
