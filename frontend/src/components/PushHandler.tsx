import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { enablePush, markPushAsked, pushAlreadyAsked, pushAvailable, pushPermission, pushPlugin } from "@/lib/push";

/**
 * Notifications push dans l'application Android :
 * - à la connexion, enregistre l'appareil (et demande l'autorisation une seule fois) ;
 * - quand on touche une notification, ouvre la bonne page (message, publication, profil…).
 * Sans effet dans le navigateur ou dans une APK compilée sans Firebase.
 */
export function PushHandler() {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id;

  // Toucher une notification, et réception pendant que l'appli est ouverte (Android n'affiche alors rien : on montre seulement le test)
  useEffect(() => {
    if (!pushAvailable()) return;
    const plugin = pushPlugin()!;
    const tapped = plugin.addListener("pushNotificationActionPerformed", (action: { notification?: { data?: { url?: unknown } } }) => {
      const url = action?.notification?.data?.url;
      if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//")) router.history.push(url);
    });
    const received = plugin.addListener("pushNotificationReceived", (n: { title?: string; body?: string; data?: { type?: string } }) => {
      if (n?.data?.type === "test") toast.success(n.title || "Kalchat", { description: n.body });
    });
    return () => {
      void Promise.resolve(tapped).then((h) => h?.remove?.());
      void Promise.resolve(received).then((h) => h?.remove?.());
    };
  }, [router]);

  // Enregistrement de l'appareil une fois connecté
  useEffect(() => {
    if (!userId || !pushAvailable()) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const state = await pushPermission();
          if (state === "granted") {
            await enablePush(); // renouvelle le jeton à chaque lancement
          } else if ((state === "prompt" || state === "prompt-with-rationale") && !pushAlreadyAsked()) {
            markPushAsked(); // on ne demande qu'une fois : le réglage reste dans Paramètres › Notifications
            await enablePush();
          }
        } catch (err) {
          console.warn("Notifications push :", err);
        }
      })();
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [userId]);

  return null;
}
