import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradeOS",
  description: "Business operating system for traders, wholesalers, and retailers",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "TradeOS",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/tradeos-icon.svg",
    apple: "/tradeos-icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#c15f3c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
