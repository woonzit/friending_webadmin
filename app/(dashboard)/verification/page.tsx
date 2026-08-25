import { notFound } from "next/navigation";
import VerificationAdminConsole from "@/components/VerificationAdminConsole";
import { VERIFICATION_CONTRACT_READY } from "@/lib/contractReadiness";
import { verificationSeedCopyPairs, verificationTabKey } from "@/lib/verificationAdmin";
import english from "@/messages/en.json";
import hungarian from "@/messages/hu.json";

function previewCopy(messages: typeof english.verificationAdmin.messages) {
  return {
    label: messages.previewLabel,
    emptyTitle: messages.emptyPreview,
    emptyAction: messages.emptyAction,
    emptyCancel: messages.emptyCancel,
    nonInteractive: messages.nonInteractive,
    steps: messages.previewSteps,
    pending: messages.previewPending,
    rejected: messages.previewRejected,
  };
}

export default async function VerificationAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  if (!VERIFICATION_CONTRACT_READY) notFound();
  const query = await searchParams;
  const seedCopy = verificationSeedCopyPairs(
    english.verificationAdmin.seedCopy,
    hungarian.verificationAdmin.seedCopy,
  );
  if (!seedCopy) notFound();
  const requestedTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  return (
    <VerificationAdminConsole
      seedCopy={seedCopy}
      previewCopy={{
        en: previewCopy(english.verificationAdmin.messages),
        hu: previewCopy(hungarian.verificationAdmin.messages),
      }}
      initialTab={verificationTabKey(requestedTab)}
    />
  );
}
