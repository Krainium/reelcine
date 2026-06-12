import type { Metadata } from "next";
  import { Geist, Geist_Mono } from "next/font/google";
  import "./globals.css";
  import { Toaster } from "sonner";

  const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
  });

  const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
  });

  export const metadata: Metadata = {
    title: "REELCINE — Cinematic 3D Instagram Downloader",
    description: "Real-time Instagram video & image downloader with live 3D progress. Powered by serverless edge functions with SSE.",
    keywords: ["instagram downloader", "reel downloader", "instagram video", "instagram reels", "save instagram"],
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
      apple: "/favicon.svg",
    },
  };

  export default function RootLayout({
    children,
  }: Readonly<{
    children: React.ReactNode;
  }>) {
    return (
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
      >
        <body className="min-h-full flex flex-col bg-[#050505] text-zinc-200">
          {children}
          <Toaster position="top-center" richColors closeButton />
        </body>
      </html>
    );
  }
  