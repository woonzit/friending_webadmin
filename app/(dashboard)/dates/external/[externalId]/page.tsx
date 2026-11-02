"use client";

import { useParams, useSearchParams } from "next/navigation";
import DatesExternalEditorPage from "@/components/DatesExternalEditorPage";

export default function ExternalEventDetailPage() {
  const { externalId } = useParams<{ externalId: string }>();
  // D-149 W4: "approve and edit" opens this editor with `?correction=cor_...`; anything else is ignored.
  const correction = useSearchParams().get("correction");
  return <DatesExternalEditorPage key={externalId} externalId={externalId}
    correctionId={correction !== null && /^cor_[a-f0-9]{32}$/.test(correction) ? correction : undefined} />;
}
