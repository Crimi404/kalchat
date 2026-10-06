import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import { PrivacyContent } from "@/lib/legal";

export const Route = createFileRoute("/confidentialite")({
  head: () => ({
    meta: [
      { title: "Politique de confidentialité — Kalchat" },
      { name: "description", content: "Comment Kalchat utilise et protège tes données." },
    ],
  }),
  component: ConfidentialitePage,
});

function ConfidentialitePage() {
  return (
    <LegalPage title="Politique de confidentialité">
      <PrivacyContent />
    </LegalPage>
  );
}
