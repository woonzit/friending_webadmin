"use client";

import { useParams } from "next/navigation";
import DatesIntakeReviewPage from "@/components/DatesIntakeReviewPage";

export default function DatesIntakeDetailPage() {
  const { intakeId } = useParams<{ intakeId: string }>();
  return <DatesIntakeReviewPage key={intakeId} intakeId={intakeId} />;
}
