import { toast } from "sonner";

function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** Nom de fichier proposé au téléchargement (dérivé de l'adresse, sinon générique). */
export function mediaFileName(url: string, type: "image" | "video"): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    if (/\.[a-z0-9]{2,5}$/i.test(last)) return last;
  } catch {
    /* adresse invalide : nom générique */
  }
  return `kalchat-${Date.now()}.${type === "video" ? "mp4" : "jpg"}`;
}

/** Adresse qui force le téléchargement (le stockage Supabase répond « attachment » avec ?download=). */
function forcedDownloadUrl(url: string, name: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("download", name);
    return u.toString();
  } catch {
    return url;
  }
}

type FsPlugin = {
  downloadFile: (o: { url: string; path: string; directory?: string; recursive?: boolean; progress?: boolean }) => Promise<{ path?: string }>;
  addListener: (event: "progress", cb: (p: { url: string; bytes: number; contentLength: number }) => void) => Promise<{ remove: () => Promise<void> }>;
};

function nativeFilesystem(): FsPlugin | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: { Filesystem?: FsPlugin }; registerPlugin?: (n: string) => FsPlugin } }).Capacitor;
  return cap?.Plugins?.Filesystem ?? cap?.registerPlugin?.("Filesystem") ?? null;
}

/** Téléchargement direct dans l'appli (sans ouvrir le navigateur), avec progression. Renvoie false si impossible (ancienne APK, erreur). */
async function downloadInsideApp(url: string, name: string): Promise<boolean> {
  const fs = nativeFilesystem();
  if (!fs) return false;
  const toastId = `dl-${name}`;
  let listener: { remove: () => Promise<void> } | null = null;
  try {
    toast.loading("Téléchargement… 0 %", { id: toastId });
    listener = await fs.addListener("progress", (p) => {
      if (p.url !== url || !p.contentLength) return;
      const pct = Math.min(100, Math.round((p.bytes / p.contentLength) * 100));
      toast.loading(`Téléchargement… ${pct} %`, { id: toastId });
    });
    await fs.downloadFile({ url, path: `Kalchat/${name}`, directory: "DOCUMENTS", recursive: true, progress: true });
    toast.success("Enregistré dans Documents/Kalchat", { id: toastId });
    return true;
  } catch {
    toast.dismiss(toastId);
    return false;
  } finally {
    void listener?.remove();
  }
}

/** Télécharge une photo ou une vidéo sur le téléphone / l'ordinateur. */
export async function downloadMedia(url: string, type: "image" | "video") {
  const name = mediaFileName(url, type);

  // Dans l'appli Android : téléchargement direct ; si ce n'est pas possible (ancienne APK sans le module), on retombe sur le navigateur
  if (isNativeApp()) {
    if (await downloadInsideApp(url, name)) return;
    window.open(forcedDownloadUrl(url, name), "_blank");
    toast.info("Téléchargement lancé dans ton navigateur");
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    toast.success("Téléchargement lancé");
  } catch {
    // Dernier recours : ouverture de l'adresse en mode téléchargement
    window.open(forcedDownloadUrl(url, name), "_blank");
  }
}
