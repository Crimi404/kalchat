import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import logo from "@/assets/kalchat-logo.png";
import { GUEST_PROMPT_EVENT, type GuestReason } from "@/lib/guest";
import { rememberDestination } from "@/lib/share";
import { useBackHandler } from "@/lib/back";

const MESSAGES: Record<GuestReason, { title: string; text: string }> = {
  like: { title: "Tu aimes cette publication ?", text: "Connecte-toi pour liker, et dire à son auteur que tu as apprécié." },
  comment: { title: "Rejoins la conversation", text: "Connecte-toi pour commenter et répondre aux autres membres." },
  share: { title: "Partage avec ta communauté", text: "Connecte-toi pour repartager cette publication dans ton fil." },
  save: { title: "Garde-la pour plus tard", text: "Connecte-toi pour enregistrer des publications et les retrouver sur ton profil." },
  create: { title: "À toi de publier !", text: "Connecte-toi pour partager des textes, des photos, des vidéos et des stories." },
  message: { title: "Discute en direct", text: "Connecte-toi pour écrire à tes amis, créer des groupes et envoyer des messages vocaux." },
  profile: { title: "Ton profil t'attend", text: "Crée ton compte gratuit pour personnaliser ton profil et suivre tes amis." },
  explore: { title: "Explore Kalchat", text: "Connecte-toi pour découvrir les hashtags tendance, les catégories et les membres." },
  search: { title: "Retrouve des membres", text: "Connecte-toi pour rechercher des membres et les suivre." },
  generic: { title: "Rejoins Kalchat", text: "Connecte-toi ou crée un compte gratuit pour profiter de toutes les fonctionnalités." },
};

/** Fenêtre d'invitation à se connecter, montée une seule fois à la racine de l'application. */
export function GuestPrompt() {
  const [reason, setReason] = useState<GuestReason | null>(null);
  const href = useRouterState({ select: (s) => s.location.href });

  useEffect(() => {
    const onOpen = (e: Event) => setReason((e as CustomEvent<GuestReason>).detail ?? "generic");
    window.addEventListener(GUEST_PROMPT_EVENT, onOpen);
    return () => window.removeEventListener(GUEST_PROMPT_EVENT, onOpen);
  }, []);

  useBackHandler(() => setReason(null), reason !== null);
  if (!reason) return null;
  const m = MESSAGES[reason];
  const goAuth = () => {
    rememberDestination(href); // après la connexion, retour sur la page en cours
    setReason(null);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setReason(null)} />
      <div className="animate-sheet-up relative w-full max-w-md rounded-t-3xl border border-border bg-card p-6 pb-8 text-center sm:rounded-3xl">
        <button aria-label="Fermer" onClick={() => setReason(null)} className="absolute right-3 top-3 rounded-full p-2 text-muted-foreground hover:bg-secondary">
          <X className="h-5 w-5" />
        </button>
        <img src={logo} alt="Kalchat" width={56} height={56} className="mx-auto h-14 w-14" />
        <h2 className="mt-3 text-lg font-bold text-foreground">{m.title}</h2>
        <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted-foreground">{m.text}</p>
        <div className="mt-5 space-y-2">
          <Link to="/auth" onClick={goAuth} className="brand-gradient glow-primary block w-full rounded-xl py-3 text-sm font-bold text-primary-foreground">
            Se connecter / Créer un compte
          </Link>
          <button onClick={() => setReason(null)} className="w-full rounded-xl py-2.5 text-sm font-semibold text-muted-foreground hover:bg-secondary">
            Continuer à regarder
          </button>
        </div>
      </div>
    </div>
  );
}
