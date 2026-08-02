import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rauchat",
  description: "Rauchat — chat with live model telemetry.",
};

/* The shell owns the viewport and scrolls internally, so the page must map
   1:1 to device pixels or the composer lands off-screen on a phone. Zoom is
   deliberately left unclamped — pinch-to-zoom is an accessibility control. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
