/**
 * Manufacturer style codes that reliably establish a sneaker's sizing group and edition.
 *
 * Only codes whose meaning is well established are listed. An unknown code proves nothing and is
 * never used to infer a size group, edition or colorway. Base codes (e.g. "DD1391") identify a
 * release line across colorways; full codes (e.g. "DD1391-100") identify one colorway.
 */
export type SizingGroup = "men" | "women" | "youth";
type StyleLine = { product: string; group: SizingGroup; edition: "retro" };

const LINES: Record<string, StyleLine> = {
  // Nike Dunk Low Retro (men's sizing). DD1391-100 is the white/black "Panda" colorway.
  DD1391: { product: "dunk low", group: "men", edition: "retro" },
  // Nike Dunk Low Retro (women's sizing). DD1503-101 is the women's white/black colorway.
  DD1503: { product: "dunk low", group: "women", edition: "retro" },
  // Nike Dunk Low (grade school / youth sizing). CW1590-100 is the GS white/black colorway.
  CW1590: { product: "dunk low", group: "youth", edition: "retro" },
};

/** Style codes stated in a listing title or item specifics: "DD1391-100", "DD1391 100", "dd1391". */
export function styleCodesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.toUpperCase().matchAll(/\b([A-Z]{2}\d{4})(?:[-\s]?(\d{3}))?\b/g)) out.add(m[2] ? `${m[1]}-${m[2]}` : m[1]);
  return [...out];
}

/** The known release line for a code, or null when the code isn't in the reviewed table. */
export function knownStyle(code: string): (StyleLine & { code: string }) | null {
  const base = code.toUpperCase().slice(0, 6);
  return LINES[base] ? { ...LINES[base], code: code.toUpperCase() } : null;
}

/**
 * The sizing group a listing's known style codes establish for a product, or null when there are none
 * (or they disagree, which proves nothing).
 */
export function styleGroup(text: string, product: string): SizingGroup | null {
  const groups = new Set(
    styleCodesIn(text)
      .map(knownStyle)
      .filter((s): s is NonNullable<typeof s> => !!s && product.toLowerCase().includes(s.product))
      .map((s) => s.group),
  );
  return groups.size === 1 ? [...groups][0] : null;
}

/** The edition a known style code establishes ("retro"), for grouping "Dunk Low" with "Dunk Low Retro". */
export function styleEdition(text: string, product: string): string | null {
  const editions = new Set(
    styleCodesIn(text)
      .map(knownStyle)
      .filter((s): s is NonNullable<typeof s> => !!s && product.toLowerCase().includes(s.product))
      .map((s) => s.edition),
  );
  return editions.size === 1 ? [...editions][0] : null;
}
