import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Picklester — Play. Prove. Rank.",
  description: "Verified pickleball matches, MMR rankings, open play and volunteer-referee scoring.",
  applicationName: "Picklester",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/picklester-logo.png", apple: "/picklester-logo.png" },
};

export const viewport: Viewport = {
  themeColor: "#090b10",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en"><body>{children}</body></html>
  );
}
