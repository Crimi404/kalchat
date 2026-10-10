import { useState } from "react";
import { Download } from "lucide-react";
import logo from "@/assets/kalchat-logo.png";
import { APK_URL } from "@/lib/apk";
import { useBackHandler } from "@/lib/back";
import { useAppUpdate } from "@/lib/appUpdate";

const SNOOZE_KEY = "kalchat_update_snoozed";

type BrowserPlugin = { open: (o: { url: string }) => Promise<void> };

/** Télécharge la nouvelle APK : navigateur intégré d'Android (Chrome), qui propose ensuite l'installation. */
function startUpdate() {
  const url = `${window.location.origin}${APK_URL}`;
  const cap = (window as unknown as { Capacitor?: { Plugins?: { Browser?: BrowserPlugin } } }).Capacitor;
  const browser = cap?.Plugins?.Browser;
  if (browser?.open) {
    void browser.open({ url }).catch(() => { window.location.href = url; });
  } else {
    window.location.href = url; // APK sans le module « Browser »
  }
}

/**
 * Message « Nouvelle version disponible » (APK uniquement).
 * Facultatif (« Plus tard », une fois par ouverture de l'appli) pendant 14 jours, puis bloquant.
 */
export function UpdateGate() {
  const update = useAppUpdate();
  const [snoozed, setSnoozed] = useState(() => {
    try { return sessionStorage.getItem(SNOOZE_KEY) === "1"; } catch { return false; }
  });
  const open = !!update && (update.blocking || !snoozed);
  const later = () => {
    try { sessionStorage.setItem(SNOOZE_KEY, "1"); } catch { /* sans conséquence */ }
    setSnoozed(true);
  };
  useBackHandler(later, open && !update?.blocking);

  if (!update || !open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-xl">
        <img src={logo} alt="" className="mx-auto h-14 w-14 rounded-2xl object-contain" />
        <h2 className="mt-4 text-lg font-bold text-foreground">
          {update.blocking ? "Mise à jour obligatoire" : "Nouvelle version disponible"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {update.blocking
            ? `Kalchat ${update.latest} est disponible. Cette version n'est plus prise en charge : installe la mise à jour pour continuer.`
            : `Kalchat ${update.latest} est disponible (tu as la ${update.current}). Installe-la pour profiter des dernières nouveautés.`}
        </p>
        {!update.blocking && (
          <p className="mt-2 text-xs font-semibold text-muted-foreground">
            {update.daysLeft <= 1 ? "Dernier jour avant la mise à jour obligatoire." : `Il te reste ${update.daysLeft} jours avant la mise à jour obligatoire.`}
          </p>
        )}
        <button onClick={startUpdate} className="brand-gradient mt-5 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-bold text-primary-foreground">
          <Download className="h-4 w-4" /> Mettre à jour
        </button>
        {!update.blocking && (
          <button onClick={later} className="mt-2 w-full rounded-full py-2.5 text-sm font-semibold text-muted-foreground hover:bg-secondary">
            Plus tard
          </button>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">Si Android le demande, autorise l'installation, puis ouvre le fichier téléchargé.</p>
      </div>
    </div>
  );
}
