import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/jasterka/Providers";

export const metadata: Metadata = {
  title: "Pizza Jašterka - Rozvoz pizze a jedál",
  description: "Pizza Jašterka - čerstvá pizza z drevenej pece. Rozvoz po Hlohovci a okolí.",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sk" suppressHydrationWarning>
      <body
        className="antialiased bg-background text-foreground"
      >
        <Providers>
          {children}
          <Toaster position="top-right" richColors />
        </Providers>
      </body>
    </html>
  );
}
