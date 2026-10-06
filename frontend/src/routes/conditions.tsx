import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import { TermsContent } from "@/lib/legal";

export const Route = createFileRoute("/conditions")({
  head: () => ({
    meta: [
      { title: "Conditions d'utilisation — Kalchat" },
      { name: "description", content: "Les conditions d'utilisation de Kalchat." },
    ],
  }),
  component: ConditionsPage,
});

function ConditionsPage() {
  return (
    <LegalPage title="Conditions d'utilisation">
      <TermsContent />
    </LegalPage>
  );
}
