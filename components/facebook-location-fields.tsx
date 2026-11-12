"use client";
import { useState } from "react";
import { parseFacebookLocation, type FacebookLocation } from "../lib/facebook";
const cities = [
  { label: "New York, NY", lat: 40.7128, lng: -74.006 },
  { label: "Los Angeles, CA", lat: 34.0522, lng: -118.2437 },
  { label: "Chicago, IL", lat: 41.8781, lng: -87.6298 },
  { label: "Austin, TX", lat: 30.2672, lng: -97.7431 },
  { label: "Miami, FL", lat: 25.7617, lng: -80.1918 },
];
export function FacebookLocationFields({
  value,
  onChange,
  disabled = false,
}: {
  value: FacebookLocation | null;
  onChange: (v: FacebookLocation | null) => void;
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState({
    label: value?.label || "",
    lat: value ? String(value.lat) : "",
    lng: value ? String(value.lng) : "",
    radius: value ? String(value.radiusKm) : "25",
    condition: value?.condition || "",
  });
  const [error, setError] = useState("");
  function apply() {
    try {
      if (!custom.lat.trim() || !custom.lng.trim() || !custom.radius.trim())
        throw Error("Enter coordinates and radius.");
      onChange(
        parseFacebookLocation({
          label: custom.label,
          lat: Number(custom.lat),
          lng: Number(custom.lng),
          radiusKm: Number(custom.radius),
          condition: custom.condition,
        }),
      );
      setError("");
    } catch (e) {
      onChange(null);
      setError((e as Error).message);
    }
  }
  return (
    <div className="block">
      <h3>Facebook Marketplace search area</h3>
      <p className="fine">
        Optional. City selection uses built-in coordinates and spends no
        credits. Provider requests remain disabled pending permitted-use
        verification. No Facebook login is needed in this app.
      </p>
      <label className="notes-label">
        City
        <select
          disabled={disabled}
          value={
            cities.some((c) => c.label === value?.label) ? value!.label : ""
          }
          onChange={(e) => {
            const city = cities.find((c) => c.label === e.target.value);
            if (!city) {
              onChange(null);
              return;
            }
            const next = {
              ...city,
              radiusKm: value?.radiusKm || 25,
              condition: value?.condition || "",
            } as FacebookLocation;
            onChange(next);
            setCustom({
              label: next.label,
              lat: String(next.lat),
              lng: String(next.lng),
              radius: String(next.radiusKm),
              condition: next.condition,
            });
          }}
        >
          <option value="">Not selected / custom coordinates</option>
          {cities.map((c) => (
            <option key={c.label}>{c.label}</option>
          ))}
        </select>
      </label>
      <div className="identity-fields">
        <label>
          Location label
          <input
            disabled={disabled}
            maxLength={120}
            value={custom.label}
            onChange={(e) => {
              onChange(null);
              setCustom({ ...custom, label: e.target.value });
            }}
          />
        </label>
        <label>
          Radius (km, 1–250)
          <input
            disabled={disabled}
            type="number"
            min="1"
            max="250"
            value={custom.radius}
            onChange={(e) => {
              onChange(null);
              setCustom({ ...custom, radius: e.target.value });
            }}
          />
        </label>
        <label>
          Latitude
          <input
            disabled={disabled}
            type="number"
            min="-90"
            max="90"
            step="any"
            value={custom.lat}
            onChange={(e) => {
              onChange(null);
              setCustom({ ...custom, lat: e.target.value });
            }}
          />
        </label>
        <label>
          Longitude
          <input
            disabled={disabled}
            type="number"
            min="-180"
            max="180"
            step="any"
            value={custom.lng}
            onChange={(e) => {
              onChange(null);
              setCustom({ ...custom, lng: e.target.value });
            }}
          />
        </label>
        <label>
          Facebook condition filter
          <select
            disabled={disabled}
            value={custom.condition}
            onChange={(e) => {
              onChange(null);
              setCustom({
                ...custom,
                condition: e.target.value as FacebookLocation["condition"],
              });
            }}
          >
            <option value="">Not specified</option>
            <option value="new">New</option>
            <option value="usedLikeNew">Used — like new</option>
            <option value="usedGood">Used — good</option>
            <option value="usedFair">Used — fair</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        disabled={disabled}
        className="secondary"
        onClick={apply}
      >
        Apply search area
      </button>
      {value && (
        <p className="fine">
          Selected: {value.label} · {value.radiusKm} km
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
