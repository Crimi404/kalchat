import { uploadFile } from "@/lib/api";

/** Taille maximale acceptée par le serveur (Mo). */
export const MAX_UPLOAD_MB = 25;

/** Envoie une photo ou une vidéo vers le stockage du backend ; renvoie l'adresse publique et le type (image / video). */
export async function uploadMedia(file: File): Promise<{ url: string; type: string }> {
  return uploadFile(file);
}
