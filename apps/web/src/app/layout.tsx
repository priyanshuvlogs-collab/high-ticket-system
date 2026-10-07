import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "BookedAI",
  description: "AI appointment setter for high-ticket coaches and consultants",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a href="/" className="brand">
            BookedAI
          </a>
          <nav>
            <a href="/">Demo</a>
            <a href="/dashboard">Dashboard</a>
          </nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
