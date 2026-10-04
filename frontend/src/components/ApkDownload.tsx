import { useState } from "react";
import { Download, Smartphone, X } from "lucide-react";
import { APK_URL, useApkInfo } from "@/lib/apk";

const DISMISS_KEY = "kalchat_apk_banner_dismissed";

function sizeLabel(bytes: number) {
  return bytes > 0 ? ` · ${(bytes / 1024 / 1024).toFixed(1)} Mo` : "";
}

/**
 * Téléchargement de l'application Android.
 * Invisible dans l'application elle-même, sur iPhone, et tant qu'aucun APK n'est publié sur le site.
 * « button » : bouton pleine largeur (carte de bienvenue des visiteurs) ; « banner » : bandeau fermable (membres).
 */
export function ApkDownload({ variant }: { variant: "button" | "banner" }) {
  const info = useApkInfo();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  if (!info) return null;

  if (variant === "button") {
    return (
      <div className="mt-3">
        <a href={APK_URL} download="Kalchat.apk" className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-semibold text-foreground hover:bg-secondary">
          <Download className="h-4 w-4" /> Télécharger l'appli Android
        </a>
        <p className="mt-1 text-[11px] text-muted-foreground">Version {info.version}{sizeLabel(info.size)} · si Android le demande, autorise l'installation depuis ce navigateur.</p>
      </div>
    );
  }

  if (dismissed) return null;
  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
      <span className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary-foreground"><Smartphone className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Kalchat sur Android</p>
        <p className="text-[11px] text-muted-foreground">Installe l'appli sur ton téléphone{sizeLabel(info.size)}.</p>
      </div>
      <a href={APK_URL} download="Kalchat.apk" className="brand-gradient shrink-0 rounded-full px-3.5 py-2 text-xs font-bold text-primary-foreground">Installer</a>
      <button
        aria-label="Fermer"
        onClick={() => { try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* sans conséquence */ } setDismissed(true); }}
        className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-secondary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
