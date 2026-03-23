import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Global Tension Map",
  description: "Minimal world map showing geopolitical tension intensity in real time",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
