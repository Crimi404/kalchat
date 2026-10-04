import { uploadFile } from "@/lib/api";

/** Taille maximale acceptée par le serveur (Mo). */
export const MAX_UPLOAD_MB = 25;

const DEFAULT_MAX_SIDE = 1600; // pixels (côté le plus long) pour les photos
const JPEG_QUALITY = 0.82;

/**
 * Réduit une photo avant l'envoi (taille en pixels + compression JPEG) pour économiser le stockage.
 * Renvoie le fichier d'origine si la photo est un GIF/SVG, si le navigateur ne sait pas la lire,
 * ou si la version compressée n'est pas plus légère.
 */
export async function compressImage(file: File, maxSide = DEFAULT_MAX_SIDE): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));

    // Petite photo déjà légère : rien à gagner
    if (ratio === 1 && file.size < 300 * 1024) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.fillStyle = "#ffffff"; // le JPEG n'a pas de transparence
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file; // format illisible par le navigateur (ex. HEIC) : on envoie l'original
  }
}

/** Envoie une photo ou une vidéo vers le stockage du backend ; renvoie l'adresse publique et le type (image / video). Les photos sont compressées avant l'envoi. */
export async function uploadMedia(file: File, options: { maxSide?: number } = {}): Promise<{ url: string; type: string }> {
  const prepared = await compressImage(file, options.maxSide);
  return uploadFile(prepared);
}
