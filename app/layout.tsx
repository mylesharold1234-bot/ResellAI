import { IdentificationProvider } from "../components/identification-context";
import type { Metadata } from "next";
import { Header } from "../components/ui";
import "./globals.css";
import "./listing.css";
export const metadata: Metadata = {
  title: "ResellAI — Find the value in what you own",
  description:
    "Snap it. Price it. Sell it. Explore the ResellAI resale assistant prototype.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <IdentificationProvider>
          <Header />
          <main>{children}</main>
          <footer>
            <span>© {new Date().getFullYear()} ResellAI</span>
            <span>Less guesswork. More possibility.</span>
            <span>Phase 3 · eBay asking-price evidence</span>
          </footer>
        </IdentificationProvider>
      </body>
    </html>
  );
}
