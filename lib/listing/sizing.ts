import type { MatchDetails } from "../marketplaces";

export type Department = "" | "Men" | "Women" | "Youth";

/** Department implied by the sizing system the seller picked during identification. */
export const departmentForSystem = (system: MatchDetails["sizeSystem"]): Department =>
  system === "US Men" ? "Men" : system === "US Women" ? "Women" : system === "US Youth" ? "Youth" : "";

const SIZE = String.raw`(\d{1,2}(?:\.5)?)`;
const tokenFor = (raw: string) => raw.replace(/^0+(?=\d)/, "").replace(/\.0$/, "");

const patterns: { re: RegExp; department: Department }[] = [
  { re: new RegExp(String.raw`\b(?:us\s*)?(?:men'?s|mens|men|male|m)\s*(?:us\s*)?(?:size|sz)?\s*:?\s*${SIZE}\b`, "i"), department: "Men" },
  { re: new RegExp(String.raw`\b(?:us\s*)?(?:women'?s|womens|women|female|ladies|wmns|w)\s*(?:us\s*)?(?:size|sz)?\s*:?\s*${SIZE}\b`, "i"), department: "Women" },
  { re: new RegExp(String.raw`\b(?:youth|kids'?|gs|grade school|boys'?|girls'?)\s*(?:us\s*)?(?:size|sz)?\s*:?\s*${SIZE}\s*y?\b`, "i"), department: "Youth" },
  { re: new RegExp(String.raw`\b${SIZE}\s*(?:us\s*)?(?:men'?s|mens|m)\b`, "i"), department: "Men" },
  { re: new RegExp(String.raw`\b${SIZE}\s*(?:us\s*)?(?:women'?s|womens|w)\b`, "i"), department: "Women" },
  { re: new RegExp(String.raw`\b${SIZE}\s*y\b`, "i"), department: "Youth" },
  { re: new RegExp(String.raw`\b(?:size|sz)\s*:?\s*(?:us\s*)?${SIZE}\b`, "i"), department: "" },
];

/**
 * Read a shoe/clothing size and, when stated, the department from free text such as "Men's 10",
 * "M10", "US W 8.5", "10.5 M", "GS 6Y" or "size 9". Only explicit statements are read; nothing is guessed.
 */
export function parseSizeText(text: string | null | undefined): { size: string; department: Department } {
  const t = (text || "").trim();
  if (!t) return { size: "", department: "" };
  for (const p of patterns) {
    const m = t.match(p.re);
    if (m) return { size: tokenFor(m[1]), department: p.department };
  }
  // A bare size typed into the size field ("10", "9.5") or a letter size ("M", "XL").
  if (/^\d{1,2}(?:\.5)?$/.test(t)) return { size: tokenFor(t), department: "" };
  if (/^(xxs|xs|s|m|l|xl|xxl|xxxl|[2-5]xl)$/i.test(t)) return { size: t.toUpperCase(), department: "" };
  return { size: "", department: "" };
}

/** Department explicitly named in a product name ("Women's Dunk Low", "Air Jordan 1 GS"). */
export function departmentInName(text: string | null | undefined): Department {
  const t = (text || "").toLowerCase();
  if (/\b(women'?s|womens|wmns)\b/.test(t)) return "Women";
  if (/\b(men'?s|mens)\b/.test(t)) return "Men";
  if (/\b(gs|grade school|youth|kids'?)\b/.test(t)) return "Youth";
  return "";
}

export type SizeReading = {
  size: { value: string; from: "details" | "seller-notes" | "" };
  department: { value: Department; from: "details" | "seller-notes" | "product-name" | "" };
};

/**
 * Combine every place the seller may have stated size and department during identification:
 * the size field (which sellers often fill as "Men's 10"), the sizing system, and their own notes.
 * The product name is only used for department, and only as an AI-level inference.
 */
export function readSize(d: MatchDetails, productName?: string | null): SizeReading {
  const field = parseSizeText(d.size);
  const notes = parseSizeText([d.additionalDetails, d.variant].filter(Boolean).join(" "));
  const system = departmentForSystem(d.sizeSystem);
  const rawSize = (d.size || "").trim();
  const size = field.size
    ? { value: field.size, from: "details" as const }
    : rawSize
      ? { value: rawSize, from: "details" as const }
      : notes.size
        ? { value: notes.size, from: "seller-notes" as const }
        : { value: "", from: "" as const };
  const department = system
    ? { value: system, from: "details" as const }
    : field.department
      ? { value: field.department, from: "details" as const }
      : notes.department && (!notes.size || notes.size === size.value)
        ? { value: notes.department, from: "seller-notes" as const }
        : departmentInName(productName)
          ? { value: departmentInName(productName), from: "product-name" as const }
          : { value: "" as Department, from: "" as const };
  return { size, department };
}
