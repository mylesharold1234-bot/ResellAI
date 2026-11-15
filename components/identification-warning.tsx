import type { Identification } from "../lib/identification";
import type { MatchDetails } from "../lib/marketplaces";
import { assessIdentification } from "../lib/product-profile";

/** A gentle prompt when the identification is too general for precise price comparisons. */
export function IdentificationWarning({ identification, details }: { identification: Identification; details?: MatchDetails }) {
  const assessment = assessIdentification(identification, details);
  if (assessment.specific) return null;
  return (
    <div role="status" className="warn-box">
      <strong>A few more details will sharpen the price.</strong> Helpful: {assessment.missing.join(", ")}. You can still continue.
    </div>
  );
}
