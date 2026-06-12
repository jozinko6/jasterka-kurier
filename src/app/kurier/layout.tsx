import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Kuriér — Pizza Jašterka',
  description: 'Kuriérsky panel pre doručovateľov Pizza Jašterka',
  manifest: '/manifest-kurier.json',
  icons: {
    icon: '/icon-kurier-192.png',
    apple: '/icon-kurier-192.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#f0fdf4',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function CourierLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
