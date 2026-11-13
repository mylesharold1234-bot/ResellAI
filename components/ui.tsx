import Link from "next/link";
import {
  ArrowUpRight,
  ScanLine,
  LayoutDashboard,
  FilePenLine,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
export function Logo() {
  return (
    <Link href="/" className="logo">
      <span className="logo-mark">
        <ScanLine size={22} />
      </span>
      Resell<span>AI</span>
    </Link>
  );
}
export function Header() {
  return (
    <header className="header">
      <Logo />
      <nav aria-label="Main navigation">
        <Link href="/dashboard">
          <LayoutDashboard size={16} /> Dashboard
        </Link>
        <Link href="/listings">
          <FilePenLine size={16} /> Listings
        </Link>
        <Link className="button small" href="/analyze">
          Analyze an Item <ArrowUpRight size={16} />
        </Link>
      </nav>
    </header>
  );
}
export function DemoNotice() {
  return (
    <div className="demo-notice">
      <ShieldCheck size={17} />
      <span>
        <strong>Demo workspace.</strong> Pricing, fees, and charts are fictional
        examples unrelated to any uploaded item. No live marketplace data.
      </span>
    </div>
  );
}
export function Action({
  children = "Analyze an Item",
}: {
  children?: React.ReactNode;
}) {
  return (
    <Link className="button" href="/analyze">
      {children}
      <ArrowRight size={18} />
    </Link>
  );
}
