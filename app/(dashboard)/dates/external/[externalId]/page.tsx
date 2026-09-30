"use client";

import { useParams } from "next/navigation";
import DatesExternalEditorPage from "@/components/DatesExternalEditorPage";

export default function ExternalEventDetailPage() {
  const { externalId } = useParams<{ externalId: string }>();
  return <DatesExternalEditorPage key={externalId} externalId={externalId} />;
}
