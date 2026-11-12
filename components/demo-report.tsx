import { ReportItem } from "./report-item";
import Link from "next/link";
import { ArrowUpRight, Info } from "lucide-react";
import { DemoNotice } from "./ui";
import { HistoryChart, ProfitCalculator } from "./analytics";
import { demoMarkets } from "../lib/demo";
export default function DemoReport() {
  const forceDemo = true;
  return (
    <section className="wrap workspace">
      <DemoNotice />
      <div className="section-heading">
        <div>
          <Link className="back" href="/dashboard">
            ← Dashboard
          </Link>
          <h1 className="page-title">Your example resale report</h1>
          <p className="muted">
            A fixed sample item with an explicitly fictional pricing layout.
          </p>
        </div>
        <Link className="secondary" href="/analyze">
          Try another photo <ArrowUpRight size={17} />
        </Link>
      </div>
      <div className="report-grid">
        <ReportItem forceDemo={forceDemo} />
        <div className="panel valuation">
          <div className="row">
            <span className="eyebrow">ILLUSTRATIVE RESALE VALUE</span>
            <span className="pill">MOCK DATA</span>
          </div>
          <div className="big-value">
            $85 <span>–</span> $115
          </div>
          <p className="muted">
            Fixed demo range unrelated to your item. Not a valuation.
          </p>
          <div className="two-grid price-details">
            <div>
              <span>Demo listing price</span>
              <strong>$115</strong>
            </div>
            <div>
              <span>Demo selling price</span>
              <strong>$100</strong>
            </div>
          </div>
          <div className="info-card">
            <Info size={18} />
            <div>
              <strong>Confidence is not assessed</strong>
              <p>
                No real comparable sales have been retrieved. A future report
                will assess evidence quality and quantity.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="panel block">
        <div className="section-heading">
          <div>
            <h2>Marketplace comparison</h2>
            <p className="muted">
              Fictional figures to demonstrate the comparison layout.
            </p>
          </div>
          <span className="pill">USD · DEMO</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "Marketplace",
                  "Asking price",
                  "Median sold",
                  "Average sold",
                  "Comparables",
                  "Example fee",
                  "Proceeds¹",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {demoMarkets.map((m) => (
                <tr key={m.name}>
                  <td>
                    <strong>{m.name}</strong>
                    <small>Live data unavailable</small>
                  </td>
                  <td>${m.asking}</td>
                  <td>{m.sold === null ? "Unavailable" : `$${m.sold}`}</td>
                  <td>
                    {m.average === null ? "Unavailable" : `$${m.average}`}
                  </td>
                  <td>{m.count} demo</td>
                  <td>{m.fee}%</td>
                  <td>
                    {m.sold === null
                      ? "Unavailable"
                      : `$${(m.sold * (1 - m.fee / 100)).toFixed(2)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fine">
          ¹ Demo median sale minus illustrative fees, before shipping and other
          costs. Fees are not current platform policies. Listing URLs are
          unavailable because these records are fictional.
        </p>
      </div>
      <div className="two-grid block">
        <div className="panel">
          <div className="row">
            <h2>Price history</h2>
            <span className="pill">FICTIONAL SERIES</span>
          </div>
          <HistoryChart />
          <p className="fine">
            No historical data was collected. This chart is a visual example
            only.
          </p>
        </div>
        <div className="panel insights">
          <span className="eyebrow">KNOW WHAT THE DATA CAN TELL YOU</span>
          <h2>
            Better evidence.
            <br />
            Better decisions.
          </h2>
          <dl>
            <div>
              <dt>Demand</dt>
              <dd>Not assessed</dd>
            </div>
            <div>
              <dt>Recommended marketplace</dt>
              <dd>Insufficient data</dd>
            </div>
            <div>
              <dt>Best time to sell</dt>
              <dd>Insufficient data</dd>
            </div>
            <div>
              <dt>Seasonality & forecasts</dt>
              <dd>Unavailable</dd>
            </div>
          </dl>
          <p className="muted">
            Real recommendations need relevant sold listings, reliable fees, and
            enough history. Those integrations come in later phases.
          </p>
        </div>
      </div>
      <div className="panel block">
        <div className="section-heading">
          <div>
            <div className="eyebrow">RUN THE NUMBERS</div>
            <h2>What could you take home?</h2>
          </div>
          <span className="pill">INTERACTIVE CALCULATOR</span>
        </div>
        <ProfitCalculator />
      </div>
    </section>
  );
}
