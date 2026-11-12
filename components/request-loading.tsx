import { LoaderCircle } from "lucide-react";

export const loadingMessages = {
  identification: ["Identifying brand and model", "Examining visible details", "Preparing product identification"],
  ebay: ["Searching comparable products", "Filtering relevant listings", "Calculating your recommended price"],
};

export function RequestSpinner({ size = 20 }: { size?: number }) {
  return <LoaderCircle className="spinner request-spinner" size={size} aria-hidden="true" />;
}

export function RequestProgress({ title, messages }: { title: string; messages?: string[] }) {
  return <div className="request-progress">
    <RequestSpinner />
    <div><strong>{title}</strong>{messages?.length ? <p className="fine">{messages.join(" · ")}</p> : null}</div>
  </div>;
}

export function SkeletonLines({ count = 3 }: { count?: number }) {
  return <div className="request-skeleton-lines" aria-hidden="true">
    {Array.from({ length: count }, (_, i) => <span className="request-skeleton" key={i} />)}
  </div>;
}
