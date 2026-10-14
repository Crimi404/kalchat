import { useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const INTERVAL_MS = 60_000;

/**
 * Mesure le temps passé dans Kalchat : tant que l'appli est ouverte au premier plan, envoie le temps écoulé toutes les 60 secondes
 * (et une dernière fois quand elle passe en arrière-plan). Le temps passé en arrière-plan n'est jamais compté.
 * Le serveur additionne par jour ; ça alimente les utilisateurs actifs et les badges d'activité. Aucun affichage, échecs ignorés.
 */
export function ActivityPing() {
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let last = Date.now();
    const send = () => {
      const now = Date.now();
      const elapsed = Math.round((now - last) / 1000);
      last = now;
      if (elapsed < 3) return;
      void api("/activity/ping", { method: "POST", body: { seconds: Math.min(elapsed, 90) } }).catch(() => undefined);
    };
    const timer = window.setInterval(() => {
      if (!document.hidden) send();
      else last = Date.now();
    }, INTERVAL_MS);
    const onVisibility = () => {
      if (document.hidden) send();
      else last = Date.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId]);

  return null;
}
