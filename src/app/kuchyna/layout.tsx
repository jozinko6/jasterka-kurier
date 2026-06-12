import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Kuchyňa — Pizza Jašterka',
  description: 'Kuchynský panel pre personál Pizza Jašterka',
  manifest: '/manifest-kuchyna.json',
  icons: {
    icon: '/icon-kuchyna-192.png',
    apple: '/icon-kuchyna-192.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#1a1a1a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function KitchenLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
