import { notFound } from "next/navigation";
import ReportedContentDetail from "@/components/ReportedContentDetail";
import { REPORTED_CONTENT_CONTRACT_READY } from "@/lib/contractReadiness";

export default function ReportedContentDetailPage() {
  if (!REPORTED_CONTENT_CONTRACT_READY) notFound();
  return <ReportedContentDetail />;
}
