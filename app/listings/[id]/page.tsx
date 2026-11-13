import { ListingEditor } from "../../../components/listing/listing-editor";

export default async function ListingDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ListingEditor id={id} />;
}
