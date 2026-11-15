import Link from "next/link";
import { ArrowRight, Camera, CheckCircle2, ShieldCheck, Sparkles, Tag } from "lucide-react";

const steps = [
  { icon: Camera, title: "Snap a photo", text: "ResellAI recognizes the brand, model and details for you." },
  { icon: Tag, title: "See what it's worth", text: "We compare current eBay and Mercari listings and suggest an asking price." },
  { icon: Sparkles, title: "Review and publish", text: "Your listing is written and ready. Check it, then publish to eBay." },
];

export default function Home() {
  return (
    <>
      <section className="wrap home-hero">
        <div className="home-copy">
          <span className="pill">For resellers and everyday sellers</span>
          <h1 className="home-title">Turn a photo into a listing.</h1>
          <p className="lead">Snap your item, see what it&apos;s worth, and get a polished listing written for you. You only review and publish.</p>
          <div className="actions">
            <Link className="button" href="/analyze">
              Start with a photo <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link className="secondary" href="/analysis?demo=1">See an example</Link>
          </div>
          <ul className="home-trust" aria-label="How ResellAI works">
            <li><CheckCircle2 size={16} aria-hidden="true" /> Nothing is published until you review it</li>
            <li><ShieldCheck size={16} aria-hidden="true" /> Listings use only details you confirmed</li>
          </ul>
        </div>

        <div className="home-preview" aria-hidden="true">
          <div className="home-preview-card">
            <div className="home-preview-media">
              <div className="home-shoe" />
            </div>
            <div className="home-preview-body">
              <span className="home-preview-label">Listing ready to review</span>
              <p className="home-preview-title">Nike Dunk Low Black / White Men&apos;s Size 10 New with Box</p>
              <p className="home-preview-price">$98</p>
              <div className="home-preview-chips">
                <span>Nike</span><span>Dunk Low</span><span>US Men&apos;s 10</span><span>New</span>
              </div>
              <div className="home-preview-button">Review &amp; Publish</div>
            </div>
          </div>
          <p className="home-preview-note">Example listing</p>
        </div>
      </section>

      <section className="wrap home-steps" aria-labelledby="how">
        <h2 id="how" className="sr-only">How it works</h2>
        <ol>
          {steps.map((s, i) => (
            <li key={s.title}>
              <span className="home-step-num">{i + 1}</span>
              <s.icon size={20} aria-hidden="true" />
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
