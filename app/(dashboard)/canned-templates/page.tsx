import { notFound } from "next/navigation";
import CannedTemplatesConsole from "@/components/CannedTemplatesConsole";
import { CANNED_TEMPLATES_CONTRACT_READY } from "@/lib/contractReadiness";

export default function CannedTemplatesPage() {
  if (!CANNED_TEMPLATES_CONTRACT_READY) notFound();
  return <CannedTemplatesConsole />;
}
