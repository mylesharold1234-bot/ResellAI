"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Camera, ScanLine } from "lucide-react";

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="ResellAI home">
      <span className="logo-mark" aria-hidden="true">
        <ScanLine size={16} />
      </span>
      <span>ResellAI</span>
    </Link>
  );
}

export function Header() {
  const path = usePathname() || "/";
  const current = (href: string) => (path === href || path.startsWith(href + "/") ? "page" : undefined);
  // Reads ?debug=1 / ?debug=0 on any page, so the developer view can be switched on from anywhere.
  const debug = useDebugView();
  return (
    <header className="header">
      <div className="wrap header-inner">
        <Logo />
        <nav className="nav" aria-label="Main navigation">
          {debug && <span className="pill warning" title="Technical diagnostics are visible. Add ?debug=0 to any address to hide them.">Developer view</span>}
          <Link className="nav-link hide-sm" href="/dashboard" aria-current={current("/dashboard")}>Home</Link>
          <Link className="nav-link" href="/listings" aria-current={current("/listings")}>Listings</Link>
          <Link className="button small dark" href="/analyze">
            <Camera size={15} aria-hidden="true" /> New item
          </Link>
        </nav>
      </div>
    </header>
  );
}

/** A quiet note that a screen shows example data, not the seller's own. */
export function DemoNotice() {
  return (
    <div className="demo-notice">
      <span>
        <strong>Example data.</strong> The prices and charts here are illustrations, not real market data.
      </span>
    </div>
  );
}

export function Action({ children = "Start with a photo" }: { children?: React.ReactNode }) {
  return (
    <Link className="button" href="/analyze">
      {children}
      <ArrowRight size={17} aria-hidden="true" />
    </Link>
  );
}

/**
 * Developer view: technical diagnostics (search queries, cohorts, exclusion counts) stay out of the consumer
 * experience. Open any page with ?debug=1 to turn them on for this browser; ?debug=0 turns them off.
 */
export function useDebugView() {
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    let on = false;
    try {
      const q = new URLSearchParams(window.location.search).get("debug");
      if (q === "1") localStorage.setItem("resellai:debug", "1");
      if (q === "0") localStorage.removeItem("resellai:debug");
      on = localStorage.getItem("resellai:debug") === "1";
    } catch {
      on = new URLSearchParams(window.location.search).get("debug") === "1";
    }
    setDebug(on);
  }, []);
  return debug;
}
