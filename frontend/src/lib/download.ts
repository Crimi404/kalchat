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

type MediaPlugin = {
  getAlbums: () => Promise<{ albums: { identifier: string; name: string }[] }>;
  createAlbum: (o: { name: string }) => Promise<void>;
  saveVideo: (o: { path: string; albumIdentifier?: string; fileName?: string }) => Promise<unknown>;
  savePhoto: (o: { path: string; albumIdentifier?: string; fileName?: string }) => Promise<unknown>;
};

const GALLERY_ALBUM = "Kalchat";

function nativeMedia(): MediaPlugin | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: { Media?: MediaPlugin }; registerPlugin?: (n: string) => MediaPlugin } }).Capacitor;
  return cap?.Plugins?.Media ?? cap?.registerPlugin?.("Media") ?? null;
}

/** Retrouve (ou crée) l'album « Kalchat » de la galerie et renvoie son identifiant. */
async function galleryAlbumId(media: MediaPlugin): Promise<string | undefined> {
  const find = async () => (await media.getAlbums()).albums.find((a) => a.name === GALLERY_ALBUM)?.identifier;
  const existing = await find();
  if (existing) return existing;
  await media.createAlbum({ name: GALLERY_ALBUM });
  return find();
}

/** Enregistre la photo / vidéo dans la galerie du téléphone (album « Kalchat »). Renvoie false si impossible (ancienne APK, erreur). */
async function downloadToGallery(url: string, name: string, type: "image" | "video"): Promise<boolean> {
  const media = nativeMedia();
  if (!media) return false;
  const toastId = `gal-${name}`;
  try {
    toast.loading("Enregistrement dans la galerie…", { id: toastId });
    const albumIdentifier = await galleryAlbumId(media);
    const fileName = name.replace(/\.[a-z0-9]{2,5}$/i, ""); // le plugin veut un nom sans extension
    if (type === "video") await media.saveVideo({ path: url, albumIdentifier, fileName });
    else await media.savePhoto({ path: url, albumIdentifier, fileName });
    toast.success("Enregistré dans ta galerie (album Kalchat)", { id: toastId });
    return true;
  } catch {
    toast.dismiss(toastId);
    return false;
  }
}

/** Télécharge une photo ou une vidéo sur le téléphone / l'ordinateur. */
export async function downloadMedia(url: string, type: "image" | "video") {
  const name = mediaFileName(url, type);

  // Dans l'appli Android : 1) galerie du téléphone ; 2) à défaut dossier Documents/Kalchat ; 3) à défaut le navigateur
  if (isNativeApp()) {
    if (await downloadToGallery(url, name, type)) return;
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
