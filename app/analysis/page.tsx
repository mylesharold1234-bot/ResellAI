import DemoReport from "../../components/demo-report";
import { LiveReport } from "../../components/live-report";
export default async function Analysis({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  return (await searchParams).demo === "1" ? <DemoReport /> : <LiveReport />;
}
