import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Mail, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fetchEmailStatus } from "@/lib/email";

const DISMISS_KEY = "kalchat_email_banner_until";
const DISMISS_DAYS = 3;

/** Rappel affiché en haut du fil tant que l'adresse email n'est pas vérifiée (fermable 3 jours). */
export function EmailBanner() {
  const { user } = useAuth();
  const status = useQuery({ queryKey: ["emailStatus"], queryFn: fetchEmailStatus, enabled: !!user, staleTime: 5 * 60 * 1000 });
  const [hidden, setHidden] = useState(() => {
    try { return Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now(); } catch { return false; }
  });
  if (!user || hidden || !status.data?.enabled || status.data.verified) return null;

  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
      <span className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary-foreground"><Mail className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Vérifie ton adresse email</p>
        <p className="text-[11px] text-muted-foreground">Sécurise ton compte en 1 minute.</p>
      </div>
      <Link to="/parametres/email" className="brand-gradient shrink-0 rounded-full px-3.5 py-2 text-xs font-bold text-primary-foreground">Vérifier</Link>
      <button
        aria-label="Fermer"
        onClick={() => { try { localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400000)); } catch { /* sans conséquence */ } setHidden(true); }}
        className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-secondary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
