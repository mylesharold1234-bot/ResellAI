"use client";
import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { demoHistory } from "../lib/demo";
import { calculateProfit } from "../lib/profit";
export function HistoryChart() {
  return (
    <div
      className="chart"
      role="img"
      aria-label="Fictional monthly prices: May 112, June 108, July 115, August 103, September 107, October 100 dollars."
    >
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart
          data={demoHistory}
          margin={{ top: 15, right: 15, bottom: 0, left: -15 }}
        >
          <defs>
            <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4169e1" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#4169e1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="month" axisLine={false} tickLine={false} />
          <YAxis
            domain={[80, 130]}
            tickFormatter={(v) => `$${v}`}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip formatter={(v) => [`$${v}`, "Demo price"]} />
          <Area
            type="monotone"
            dataKey="price"
            stroke="#4169e1"
            strokeWidth={3}
            fill="url(#area)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function ProfitCalculator() {
  const [values, setValues] = useState(["100", "40", "8", "13.5", "0"]);
  const labels = [
    "Expected sale price ($)",
    "Purchase price ($)",
    "Shipping cost ($)",
    "Selling fee (%)",
    "Additional expenses ($)",
  ];
  let result;
  try {
    if (values.some((v) => v.trim() === "")) throw Error();
    result = calculateProfit(
      Number(values[0]),
      Number(values[1]),
      Number(values[2]),
      Number(values[3]),
      Number(values[4]),
    );
  } catch {}
  return (
    <div>
      <div className="calculator-inputs">
        {labels.map((label, i) => (
          <label key={label}>
            {label}
            <input
              type="number"
              min="0"
              max={i === 3 ? 100 : undefined}
              step="0.01"
              value={values[i]}
              onChange={(e) =>
                setValues(values.map((v, j) => (i === j ? e.target.value : v)))
              }
            />
          </label>
        ))}
      </div>
      {result ? (
        <div className="calc-results">
          <div>
            <span>Sale proceeds after fees, shipping & extras</span>
            <strong>${result.proceeds.toFixed(2)}</strong>
          </div>
          <div>
            <span>Total costs including purchase & fees</span>
            <strong>${result.costs.toFixed(2)}</strong>
          </div>
          <div className="profit-result">
            <span>Net profit</span>
            <strong>${result.profit.toFixed(2)}</strong>
          </div>
          <div>
            <span>ROI on purchase, shipping & extras</span>
            <strong>
              {result.roi === null ? "N/A" : `${result.roi.toFixed(1)}%`}
            </strong>
          </div>
        </div>
      ) : (
        <p role="alert" className="error">
          Enter nonnegative amounts. Selling fee must be between 0 and 100%.
        </p>
      )}
      <p className="fine">
        Defaults are illustrative. Enter your own sale price and applicable
        fees. Taxes are not included.
      </p>
    </div>
  );
}
