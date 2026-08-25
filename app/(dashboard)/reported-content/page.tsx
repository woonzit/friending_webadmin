import { notFound } from "next/navigation";
import ReportedContentQueue from "@/components/ReportedContentQueue";
import { REPORTED_CONTENT_CONTRACT_READY } from "@/lib/contractReadiness";

export default function ReportedContentPage() {
  if (!REPORTED_CONTENT_CONTRACT_READY) notFound();
  return <ReportedContentQueue />;
}
