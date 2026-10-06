import type { ReactNode } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { LEGAL_UPDATED } from "@/lib/legal";

/** Page légale publique (accessible sans compte) : flèche retour, titre, date de mise à jour. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const navigate = useNavigate();
  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) router.history.back();
    else void navigate({ to: "/" });
  }
  return (
    <div className="app-shell">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/90 px-3 py-3 backdrop-blur-xl">
        <button type="button" onClick={goBack} aria-label="Retour" className="rounded-full p-2 hover:bg-secondary">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-bold text-foreground">{title}</h1>
      </header>
      <main className="px-4 pb-16 pt-4">
        <p className="mb-4 text-xs text-muted-foreground">Dernière mise à jour : {LEGAL_UPDATED}</p>
        {children}
      </main>
    </div>
  );
}
