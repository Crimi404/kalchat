import { api, uploadFile } from "@/lib/api";

export interface MySticker {
  id: string;
  url: string;
  created_at: string;
}

export async function fetchMyStickers(): Promise<{ stickers: MySticker[]; max: number }> {
  return api<{ stickers: MySticker[]; max: number }>("/stickers/mine");
}

export async function deleteMySticker(id: string) {
  await api(`/stickers/${id}`, { method: "DELETE" });
}

export type StickerFit = "cover" | "contain";
const SIZE = 512;

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Impossible de lire cette image")); };
    img.src = url;
  });
}

/** Dessine l'image dans un carré transparent : « cover » = rognée au centre, « contain » = entière avec marges transparentes. */
export function drawSticker(canvas: HTMLCanvasElement, img: HTMLImageElement, fit: StickerFit, size: number) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  const k = fit === "cover" ? Math.max(size / img.naturalWidth, size / img.naturalHeight) : Math.min(size / img.naturalWidth, size / img.naturalHeight);
  const w = img.naturalWidth * k;
  const h = img.naturalHeight * k;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
}

/** Fabrique le fichier du sticker (512×512, WebP léger ; PNG si le téléphone ne sait pas encoder en WebP). */
export async function renderStickerFile(img: HTMLImageElement, fit: StickerFit): Promise<File> {
  const canvas = document.createElement("canvas");
  drawSticker(canvas, img, fit, SIZE);
  const toBlob = (type: string, q?: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const b = await toBlob("image/webp", q);
    if (b && b.type === "image/webp" && b.size <= 220 * 1024) return new File([b], "sticker.webp", { type: "image/webp" });
  }
  const png = await toBlob("image/png");
  if (png && png.size <= 1024 * 1024) return new File([png], "sticker.png", { type: "image/png" });
  throw new Error("Cette image est trop lourde pour un sticker");
}

export async function createSticker(img: HTMLImageElement, fit: StickerFit) {
  const file = await renderStickerFile(img, fit);
  const { url } = await uploadFile(file);
  await api("/stickers", { method: "POST", body: { url } });
}
