import { isInsideApp } from "@/lib/apk";

type StatusBarPlugin = {
  setBackgroundColor?: (o: { color: string }) => Promise<void>;
  setStyle?: (o: { style: "DARK" | "LIGHT" }) => Promise<void>;
};

/** Barre d'état d'Android (heure, batterie…) assortie au thème de Kalchat. Sans effet hors de l'APK ou sans le module. */
export function syncStatusBar(theme: "dark" | "light", color: string) {
  if (!isInsideApp()) return;
  try {
    const sb = (window as unknown as { Capacitor?: { Plugins?: { StatusBar?: StatusBarPlugin } } }).Capacitor?.Plugins?.StatusBar;
    if (!sb) return;
    void sb.setBackgroundColor?.({ color }).catch(() => undefined);
    // « DARK » = texte clair (pour fond sombre) ; « LIGHT » = texte sombre (pour fond clair)
    void sb.setStyle?.({ style: theme === "dark" ? "DARK" : "LIGHT" }).catch(() => undefined);
  } catch {
    /* sans conséquence */
  }
}
