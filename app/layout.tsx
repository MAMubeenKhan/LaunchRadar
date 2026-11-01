import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LaunchRadar",
  description: "Your quiet, passive distribution engine",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#FAF8F5] text-[#2C221E] antialiased">{children}</body>
    </html>
  );
}
