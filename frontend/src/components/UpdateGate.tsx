import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/kalchat-logo.png";
import { APK_URL } from "@/lib/apk";
import { useBackHandler } from "@/lib/back";
import { useAppUpdate } from "@/lib/appUpdate";

const SNOOZE_KEY = "kalchat_update_snoozed";

type BrowserPlugin = { open: (o: { url: string }) => Promise<void> };
type FsPlugin = {
  downloadFile: (o: { url: string; path: string; directory?: string; recursive?: boolean }) => Promise<{ path?: string }>;
};
type NativeShare = { openExternal?: (o: { url: string }) => Promise<void> };
type CapPlugins = { Browser?: BrowserPlugin; Filesystem?: FsPlugin; CapacitorShareTarget?: NativeShare };

function plugins(): CapPlugins {
  return (window as unknown as { Capacitor?: { Plugins?: CapPlugins } }).Capacitor?.Plugins ?? {};
}

/**
 * Télécharge la nouvelle APK en ouvrant le navigateur d'Android tout seul (il propose ensuite l'installation).
 * Plusieurs méthodes, de la plus fiable à la plus basique (les anciennes APK n'ont pas tous les modules) :
 * 1. ouverture directe du navigateur par Kalchat (APK récentes) ;
 * 2. navigateur intégré (module « Browser ») ;
 * 3. téléchargement direct dans Documents/Kalchat (module Fichiers) ;
 * 4. ouverture d'une nouvelle fenêtre (Android l'envoie au navigateur) ;
 * 5. en dernier recours, copie du lien à coller dans Chrome.
 */
async function startUpdate(): Promise<void> {
  const url = `${window.location.origin}${APK_URL}`;
  const { CapacitorShareTarget, Browser, Filesystem } = plugins();

  if (CapacitorShareTarget?.openExternal) {
    try {
      await CapacitorShareTarget.openExternal({ url });
      return;
    } catch {
      /* méthode suivante */
    }
  }

  if (Browser?.open) {
    try {
      await Browser.open({ url });
      return;
    } catch {
      /* méthode suivante */
    }
  }

  if (Filesystem?.downloadFile) {
    const id = "apk-update";
    try {
      toast.loading("Téléchargement de la mise à jour…", { id });
      await Filesystem.downloadFile({ url, path: "Kalchat/Kalchat.apk", directory: "DOCUMENTS", recursive: true });
      toast.success("Téléchargée ! Ouvre le fichier Documents/Kalchat/Kalchat.apk depuis tes fichiers pour l'installer.", { id, duration: 12000 });
      return;
    } catch {
      toast.dismiss(id);
    }
  }

  try {
    if (window.open(url, "_blank")) return;
  } catch {
    /* méthode suivante */
  }

  try {
    await navigator.clipboard.writeText(url);
    toast.success("Lien copié : ouvre Chrome et colle-le dans la barre d'adresse.", { duration: 10000 });
  } catch {
    toast.error("Ouvre kalchat.site dans Chrome pour télécharger la mise à jour.", { duration: 10000 });
  }
}

/**
 * Message « Nouvelle version disponible » (APK uniquement).
 * Facultatif (« Plus tard », une fois par ouverture de l'appli) pendant 14 jours, puis bloquant.
 */
export function UpdateGate() {
  const update = useAppUpdate();
  const [busy, setBusy] = useState(false);
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
        <button
          disabled={busy}
          onClick={() => { setBusy(true); void startUpdate().finally(() => setBusy(false)); }}
          className="brand-gradient mt-5 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-bold text-primary-foreground disabled:opacity-70"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Mettre à jour
        </button>
        {!update.blocking && (
          <button onClick={later} className="mt-2 w-full rounded-full py-2.5 text-sm font-semibold text-muted-foreground hover:bg-secondary">
            Plus tard
          </button>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">Si Android le demande, autorise l'installation, puis ouvre le fichier téléchargé. Tu peux aussi ouvrir kalchat.site dans Chrome et appuyer sur « Télécharger l'appli Android ».</p>
      </div>
    </div>
  );
}
