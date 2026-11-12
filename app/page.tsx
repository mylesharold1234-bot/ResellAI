import Link from "next/link";
import {
  ArrowUpRight,
  Camera,
  ChartNoAxesCombined,
  Sparkles,
  Check,
  ArrowRight,
} from "lucide-react";
import { Action } from "../components/ui";
import { ProductImage } from "../components/product-image";
export default function Home() {
  return (
    <>
      <section className="hero wrap">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="dot" /> A smarter way to resell
          </div>
          <h1>
            Snap it.
            <br />
            Price it.
            <br />
            <span>Sell it.</span>
          </h1>
          <p className="lead">
            Upload a photo and discover what your item is worth, where to sell
            it, and when to sell for the best return.
          </p>
          <div className="actions">
            <Action />
            <Link href="/analysis?demo=1" className="text-link">
              Explore a demo <ArrowUpRight size={17} />
            </Link>
          </div>
          <p className="fine">
            <Check size={15} /> No account needed <span>·</span> API key
            required for AI
          </p>
        </div>
        <div className="hero-visual">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="floating-tag">
            <Sparkles size={16} /> A little clarity. A lot of potential.
          </div>
          <div className="product-card">
            <div className="row">
              <span className="pill">EXAMPLE ANALYSIS</span>
              <span className="muted">01 / SNEAKERS</span>
            </div>
            <ProductImage />
            <div className="row">
              <div>
                <h3>Nike Dunk Low</h3>
                <p className="muted">Retro · White / Black</p>
              </div>
              <span className="condition">Good condition</span>
            </div>
            <div className="value-row">
              <div>
                <span className="muted">Illustrative resale value</span>
                <strong>$85 – $115</strong>
              </div>
              <span className="mini-chart">▁▃▂▅▄▆</span>
            </div>
            <Link href="/analysis?demo=1" className="card-link">
              View example report <ArrowRight size={17} />
            </Link>
          </div>
          <div className="float-note">
            <span className="check-circle">
              <Check size={18} />
            </span>
            <div>
              <strong>Potential, uncovered.</strong>
              <small>Demo data · not a market valuation</small>
            </div>
          </div>
        </div>
      </section>
      <section className="category-strip wrap">
        <span>ONE ASSISTANT. ENDLESS POSSIBILITIES.</span>
        <div>
          Sneakers <b>✳</b> Electronics <b>✳</b> Clothing <b>✳</b> Collectibles{" "}
          <b>✳</b> And more
        </div>
      </section>
      <section className="section wrap">
        <div className="section-heading">
          <div>
            <div className="eyebrow">FROM PHOTO TO POSSIBILITY</div>
            <h2>Your next sale starts here.</h2>
          </div>
          <p>
            Less time researching.
            <br />
            More time making your next move.
          </p>
        </div>
        <div className="three-grid">
          {[
            {
              icon: Camera,
              n: "01",
              title: "Start with a snapshot",
              text: "Upload a photo or use your camera. A simple first step for anything you want to sell.",
            },
            {
              icon: Sparkles,
              n: "02",
              title: "Understand its identity",
              text: "Review AI identification, add details, and correct anything that needs a closer look.",
            },
            {
              icon: ChartNoAxesCombined,
              n: "03",
              title: "Explore your next move",
              text: "Try the profit calculator and explore a clearly labeled demo pricing report.",
            },
          ].map((x) => (
            <article className="feature" key={x.n}>
              <div className="row">
                <x.icon size={25} />
                <span>{x.n}</span>
              </div>
              <h3>{x.title}</h3>
              <p>{x.text}</p>
            </article>
          ))}
        </div>
        <div className="phase-note">
          You’re exploring an early prototype. AI identification requires a
          configured API key. eBay asking-price evidence requires authorized
          developer access.
        </div>
      </section>
    </>
  );
}
