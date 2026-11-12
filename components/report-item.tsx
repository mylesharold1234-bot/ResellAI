"use client";
import { ProductImage } from "./product-image";
import { useIdentification } from "./identification-context";
import type { IdentificationState } from "../lib/identification-workflow";
import {
  fieldLabels,
  identityFields,
  type Identification,
} from "../lib/identification";
export function IdentificationDetails({
  identification,
}: {
  identification: Identification;
}) {
  return (
    <dl>
      {identityFields.map((k) => (
        <div key={k}>
          <dt>{fieldLabels[k]}</dt>
          <dd>{identification[k] || "Unknown / not visible"}</dd>
        </div>
      ))}
    </dl>
  );
}
export function ReportItem({ forceDemo = false }: { forceDemo?: boolean }) {
  const { state } = useIdentification();
  return <ReportItemContent state={state} forceDemo={forceDemo} />;
}
export function ReportItemContent({
  state,
  forceDemo = false,
}: {
  state: IdentificationState;
  forceDemo?: boolean;
}) {
  const item = forceDemo ? null : state.confirmed;
  return (
    <div className="panel item-panel">
      <ProductImage small photo={item ? state.photos[0]?.url : undefined} />
      {item ? (
        <>
          <span className="pill">CONFIRMED BY YOU · AI ASSISTED</span>
          <h2>{item.productName}</h2>
          <p className="muted">{item.category}</p>
          <IdentificationDetails identification={item} />
          <p className="fine">
            AI confidence: {item.confidence} (self-assessed).{" "}
            {state.edited ? "Includes your corrections." : "Reviewed by you."}{" "}
            This is not an authenticity check.
          </p>
          {item.uncertainties.length > 0 && (
            <div className="info-card">
              <strong>Uncertainty remains</strong>
              <ul>
                {item.uncertainties.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="fine">
            Photos and identification are kept only while this app is open.
            Reloading clears them.
          </p>
        </>
      ) : (
        <>
          <span className="pill">DEMO ITEM · SNEAKERS</span>
          <h2>Nike Dunk Low</h2>
          <p className="muted">Retro · White / Black “Panda”</p>
          <dl>
            <div>
              <dt>Brand</dt>
              <dd>Nike</dd>
            </div>
            <div>
              <dt>Condition</dt>
              <dd>Good (illustrative)</dd>
            </div>
            <div>
              <dt>Model identifier</dt>
              <dd>Not verified</dd>
            </div>
            <div>
              <dt>Identification</dt>
              <dd>Fixed example</dd>
            </div>
          </dl>
          <p className="fine">
            No confirmed identification is available. This is a fixed demo item.
          </p>
        </>
      )}
    </div>
  );
}
