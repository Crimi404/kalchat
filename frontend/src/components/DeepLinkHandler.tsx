import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { isInsideApp } from "@/lib/apk";

interface AppPlugin {
  addListener: (event: "appUrlOpen", cb: (e: { url?: string }) => void) => Promise<{ remove: () => void }> | { remove: () => void };
  getLaunchUrl?: () => Promise<{ url?: string } | undefined>;
}

const HOSTS = ["kalchat.site", "www.kalchat.site"];
const HANDLED_KEY = "kalchat_launch_url_handled";

/**
 * Liens « https://kalchat.site/... » ouverts dans l'APK (App Links Android) :
 * l'appli s'ouvre et affiche directement la bonne page (publication, profil, groupe…).
 * Sans effet dans le navigateur. Le fichier de vérification est servi par le backend (/.well-known/assetlinks.json).
 */
export function DeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    if (!isInsideApp()) return;
    const App = (window as unknown as { Capacitor?: { Plugins?: { App?: AppPlugin } } }).Capacitor?.Plugins?.App;
    if (!App) return; // ancienne APK sans le module

    const open = (raw?: string) => {
      if (!raw) return;
      try {
        const u = new URL(raw);
        if (u.protocol !== "https:" || !HOSTS.includes(u.hostname)) return;
        const path = `${u.pathname}${u.search}${u.hash}`;
        if (!path.startsWith("/") || path.startsWith("//")) return;
        const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (path !== current) router.history.push(path);
      } catch {
        /* adresse invalide : on ignore */
      }
    };

    // Ouverture à froid : le lien qui a lancé l'appli (une seule fois, pas à chaque rechargement de la page)
    void App.getLaunchUrl?.()
      .then((r) => {
        if (!r?.url) return;
        try {
          if (sessionStorage.getItem(HANDLED_KEY) === r.url) return;
          sessionStorage.setItem(HANDLED_KEY, r.url);
        } catch {
          /* stockage indisponible */
        }
        open(r.url);
      })
      .catch(() => undefined);

    // Appli déjà ouverte : un nouveau lien arrive
    const sub = App.addListener("appUrlOpen", (e) => open(e.url));
    return () => {
      void Promise.resolve(sub).then((h) => h?.remove?.());
    };
  }, [router]);

  return null;
}
