import { IdentificationProvider } from "../components/identification-context";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Header } from "../components/ui";
import "./globals.css";
import "./listing.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans" });

export const metadata: Metadata = {
  title: "ResellAI — Turn a photo into a listing",
  description: "Snap a photo, see what it's worth, and publish a polished listing in minutes.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fafaf8" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <IdentificationProvider>
          <Header />
          <main>{children}</main>
          <footer className="site-footer">
            <div className="wrap">
              <span>© {new Date().getFullYear()} ResellAI</span>
              <span>Prices come from current listings, not completed sales.</span>
            </div>
          </footer>
        </IdentificationProvider>
      </body>
    </html>
  );
}
