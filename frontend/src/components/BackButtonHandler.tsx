import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { runBackHandler } from "@/lib/back";
import { isInsideApp } from "@/lib/apk";

interface AppPlugin {
  addListener: (event: "backButton", cb: () => void) => Promise<{ remove: () => void }> | { remove: () => void };
  exitApp: () => void;
}

function nativeApp(): AppPlugin | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: { App?: AppPlugin }; registerPlugin?: (name: string) => AppPlugin } }).Capacitor;
  return cap?.Plugins?.App ?? null;
}

/**
 * Bouton retour d'Android dans l'application :
 * 1. ferme le menu / la feuille ouvert ; 2. sinon revient à la page précédente ;
 * 3. sinon (page ouverte directement) va à l'accueil ; 4. sur l'accueil, il faut appuyer deux fois pour quitter.
 * Sans ce réglage, Android quittait l'application dès qu'il n'y avait plus d'historique reconnu.
 */
export function BackButtonHandler() {
  const router = useRouter();

  useEffect(() => {
    if (!isInsideApp()) return;
    const App = nativeApp();
    if (!App) return; // ancienne version de l'APK sans le module : comportement d'Android inchangé
    let lastBack = 0;
    const sub = App.addListener("backButton", () => {
      if (runBackHandler()) return;

      const idx = (window.history.state as { __TSR_index?: number } | null)?.__TSR_index;
      const canGoBack = typeof idx === "number" ? idx > 0 : window.history.length > 1;
      if (canGoBack) {
        router.history.back();
        return;
      }
      if (router.state.location.pathname !== "/") {
        void router.navigate({ to: "/", replace: true });
        return;
      }
      const now = Date.now();
      if (now - lastBack < 2000) {
        App.exitApp();
        return;
      }
      lastBack = now;
      toast("Appuie encore une fois pour quitter");
    });
    return () => {
      void Promise.resolve(sub).then((h) => h?.remove?.());
    };
  }, [router]);

  return null;
}
