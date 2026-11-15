import Link from "next/link";
import { ArrowRight, Camera } from "lucide-react";

/** A fixed, clearly labeled example of the price report. No real market data is shown or implied. */
export default function DemoReport() {
  return (
    <section className="wrap workspace report">
      <div className="demo-notice">
        <span><strong>Example.</strong> This is a sample report with made-up numbers, so you can see how ResellAI works.</span>
      </div>

      <header className="report-head">
        <div className="report-photo demo-photo" aria-hidden="true"><Camera size={26} /></div>
        <div className="report-title">
          <h1>Nike Dunk Low</h1>
          <div className="chip-row">
            {["Nike", "Size 10 US Men's", "New", "With box", "Black / White"].map((c) => <span key={c} className="chip">{c}</span>)}
          </div>
        </div>
      </header>

      <section className="card price-card" aria-labelledby="demo-price">
        <div className="price-hero">
          <p id="demo-price" className="price-label">Suggested asking price</p>
          <p className="price-value">$98.00</p>
          <p className="muted">From current eBay listings. These are asking prices, not completed sales.</p>
          <div className="price-cta">
            <div className="create-listing">
              <Link className="button" href="/analyze">Try it with your item <ArrowRight size={17} aria-hidden="true" /></Link>
              <p className="fine">Your listing is written for you. Nothing is published until you review it.</p>
            </div>
          </div>
        </div>
        <div className="market-rows">
          <section className="market-row" aria-label="eBay price (example)">
            <div className="market-row-head"><span className="market-name">eBay</span><span className="pill success">Price found</span></div>
            <p className="market-price">$98.00</p>
            <p className="market-why">Based on 14 similar eBay listings. Most ask $89–$110.</p>
          </section>
          <section className="market-row" aria-label="Mercari price (example)">
            <div className="market-row-head"><span className="market-name">Mercari</span><span className="pill">No price yet</span></div>
            <p className="market-price is-empty" aria-hidden="true">—</p>
            <p className="market-why"><strong>Prices vary too much to recommend one.</strong> Similar Mercari listings range from $36 to $122, because they mix different sizes and conditions.</p>
            <p className="market-hint">When that happens, ResellAI tells you why instead of guessing.</p>
          </section>
        </div>
      </section>

      <div className="report-sections">
        <details className="disclosure">
          <summary>How ResellAI prices an item</summary>
          <div className="disclosure-body">
            <ul className="evidence-list">
              <li>We search eBay and Mercari for items currently listed that match yours.</li>
              <li>Listings that don&apos;t match (other sizes, models or conditions) are left out.</li>
              <li>We only suggest a price when enough similar listings agree. Otherwise we explain what&apos;s missing.</li>
              <li>Prices are asking prices from active listings, not completed sales.</li>
            </ul>
          </div>
        </details>
      </div>
    </section>
  );
}
