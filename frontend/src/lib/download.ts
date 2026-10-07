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

/** Télécharge une photo ou une vidéo sur le téléphone / l'ordinateur. */
export async function downloadMedia(url: string, type: "image" | "video") {
  const name = mediaFileName(url, type);

  // Dans l'appli Android : on laisse le navigateur du téléphone gérer le téléchargement
  if (isNativeApp()) {
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
