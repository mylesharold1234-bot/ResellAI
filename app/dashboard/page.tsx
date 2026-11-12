import { LatestItemCard } from "../../components/latest-item-card";
import { ProductImage } from "../../components/product-image";
import Link from "next/link";
import { Plus, ArrowUpRight, Package, Wallet, ScanLine } from "lucide-react";
import { DemoNotice } from "../../components/ui";
export default function Dashboard() {
  return (
    <section className="wrap workspace">
      <DemoNotice />
      <div className="section-heading">
        <div>
          <div className="eyebrow">YOUR RESELLING WORKSPACE</div>
          <h1 className="page-title">A little insight. More upside.</h1>
          <p className="muted">
            Your latest confirmed item appears here during this session.
          </p>
        </div>
        <Link className="button" href="/analyze">
          <Plus size={18} />
          Analyze an Item
        </Link>
      </div>
      <div className="three-grid stats">
        {[
          { icon: Package, label: "Example items", value: "1" },
          {
            icon: Wallet,
            label: "Illustrative inventory value",
            value: "$85 – $115",
          },
          { icon: ScanLine, label: "Saved analyses", value: "0" },
        ].map((s) => (
          <div className="panel" key={s.label}>
            <s.icon size={20} />
            <p className="muted">{s.label}</p>
            <strong className="stat-value">{s.value}</strong>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <h2>Explore an example</h2>
        <span className="pill">DEMO INVENTORY</span>
      </div>
      <div className="inventory-grid">
        <LatestItemCard />
        <Link href="/analysis?demo=1" className="panel inventory-card">
          <ProductImage small />
          <div className="row">
            <h3>Nike Dunk Low</h3>
            <ArrowUpRight size={20} />
          </div>
          <p className="muted">Sneakers · Good condition · Demo</p>
          <div className="row">
            <strong>$85 – $115</strong>
            <span className="muted">Illustrative value</span>
          </div>
        </Link>
        <Link href="/analyze" className="add-card">
          <Plus size={28} />
          <h3>Find the value in your next item</h3>
          <p>Start with a photo. Explore the possibilities.</p>
        </Link>
      </div>
      <div className="info-card">
        <strong>A home for your future finds.</strong>
        <p>
          Accounts, saved analyses, and inventory tracking are planned for a
          later phase. Your current session can show an identified item.
          Reloading clears it; permanent saving is not connected.
        </p>
      </div>
    </section>
  );
}
