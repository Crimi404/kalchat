import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { isInsideApp } from "@/lib/apk";
import { FONTS, resolveFont, resolveTheme } from "@/lib/themes";

/**
 * Thème des discussions (APK uniquement) : fond (thème, couleur ou photo du téléphone), couleur de MES bulles et police des messages.
 * Tout reste sur le téléphone : les réglages dans localStorage, les photos (réduites) dans IndexedDB.
 * Un thème « par défaut » s'applique à toutes les discussions ; une discussion peut avoir le sien.
 */
export interface ChatTheme {
  /** null = fond d'origine · "photo" = photo du téléphone · identifiant de thème · couleur « #rrggbb » */
  wallpaper: string | null;
  /** Assombrissement du fond (0 à 0,7) pour garder les messages lisibles. */
  dim: number;
  /** Couleur de mes bulles : identifiant de thème ou « #rrggbb » ; null = violet Kalchat. */
  bubble: string | null;
  /** Police des messages : identifiant de police (« serif », « mono »…) ; null = police Classique d'origine. */
  font: string | null;
  /** Change à chaque nouvelle photo, pour recharger l'image. */
  photoRev: number;
}

export const DEFAULT_CHAT_THEME: ChatTheme = { wallpaper: null, dim: 0.25, bubble: null, font: null, photoRev: 0 };
export const MAX_DIM = 0.7;

interface Store {
  global: ChatTheme;
  chats: Record<string, ChatTheme>;
}

const KEY = "kalchat_chat_theme_v1";

export function chatThemeSupported(): boolean {
  return isInsideApp();
}

function clean(t: unknown): ChatTheme {
  const o = (t && typeof t === "object" ? t : {}) as Partial<ChatTheme>;
  const wallpaper = typeof o.wallpaper === "string" && (o.wallpaper === "photo" || resolveTheme(o.wallpaper)) ? o.wallpaper : null;
  const bubble = typeof o.bubble === "string" && resolveTheme(o.bubble) ? o.bubble : null;
  const dim = typeof o.dim === "number" && o.dim >= 0 && o.dim <= MAX_DIM ? o.dim : DEFAULT_CHAT_THEME.dim;
  const font = typeof o.font === "string" && o.font !== "sans" && FONTS.some((f) => f.id === o.font) ? o.font : null;
  return { wallpaper, bubble, dim, font, photoRev: typeof o.photoRev === "number" ? o.photoRev : 0 };
}

function read(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null") as { global?: unknown; chats?: Record<string, unknown> } | null;
    const chats: Record<string, ChatTheme> = {};
    for (const [id, t] of Object.entries(raw?.chats ?? {})) chats[id] = clean(t);
    return { global: clean(raw?.global), chats };
  } catch {
    return { global: { ...DEFAULT_CHAT_THEME }, chats: {} };
  }
}

let store: Store = typeof window === "undefined" ? { global: { ...DEFAULT_CHAT_THEME }, chats: {} } : read();
const listeners = new Set<() => void>();

function commit(next: Store) {
  store = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* stockage indisponible : le thème ne sera pas conservé */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function useStore(): Store {
  return useSyncExternalStore(subscribe, () => store, () => store);
}

// ---------- Photos (IndexedDB) ----------
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("kalchat_chat_theme", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("photos");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve) => {
      const req = run(db.transaction("photos", mode).objectStore("photos"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

const photoGet = (key: string) => withStore<Blob | undefined>("readonly", (s) => s.get(key));
const photoPut = (key: string, blob: Blob) => withStore("readwrite", (s) => s.put(blob, key));
const photoDelete = (key: string) => withStore("readwrite", (s) => s.delete(key));

/** Réduit la photo (1280 px max, JPEG) : elle reste légère et le fond s'affiche vite. */
async function compressPhoto(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Photo illisible"))), "image/jpeg", 0.82));
}

// ---------- Lecture / modification ----------
/** `scope` : null = thème par défaut ; sinon l'identifiant d'une discussion. */
function sourceOf(scope: string | null, s: Store = store): { key: string; theme: ChatTheme; own: boolean } {
  if (scope && s.chats[scope]) return { key: `chat:${scope}`, theme: s.chats[scope], own: true };
  return { key: "global", theme: s.global, own: scope === null };
}

/** Une discussion qui n'a pas encore son thème en reçoit un, copié du thème par défaut (photo comprise). */
async function ensureOwn(scope: string | null) {
  if (scope === null || store.chats[scope]) return;
  const base = store.global;
  if (base.wallpaper === "photo") {
    const blob = await photoGet("global");
    if (blob) await photoPut(`chat:${scope}`, blob);
  }
  commit({ ...store, chats: { ...store.chats, [scope]: { ...base } } });
}

export async function updateChatTheme(scope: string | null, patch: Partial<ChatTheme>) {
  await ensureOwn(scope);
  if (scope === null) commit({ ...store, global: clean({ ...store.global, ...patch }) });
  else commit({ ...store, chats: { ...store.chats, [scope]: clean({ ...store.chats[scope], ...patch }) } });
}

export async function setChatPhoto(scope: string | null, file: File) {
  const blob = await compressPhoto(file);
  await ensureOwn(scope);
  await photoPut(sourceOf(scope).key, blob);
  await updateChatTheme(scope, { wallpaper: "photo", photoRev: Date.now() });
}

/** Thème par défaut : tout remettre à zéro. Discussion : revenir au thème par défaut. */
export async function resetChatTheme(scope: string | null) {
  if (scope === null) {
    await photoDelete("global");
    commit({ ...store, global: { ...DEFAULT_CHAT_THEME } });
    return;
  }
  await photoDelete(`chat:${scope}`);
  const { [scope]: _removed, ...rest } = store.chats;
  void _removed;
  commit({ ...store, chats: rest });
}

export interface ResolvedChatTheme {
  /** Thème effectif de la discussion (le sien, sinon le thème par défaut). */
  theme: ChatTheme;
  /** Cette discussion a-t-elle son propre thème ? */
  hasOwn: boolean;
  /** Style à poser sur la zone des messages. */
  wallpaperStyle: CSSProperties;
  /** Style de MES bulles (null = violet Kalchat d'origine). */
  bubbleStyle: CSSProperties | null;
  /** Police des messages (vide = police d'origine). */
  fontStyle: CSSProperties;
}

export function useChatTheme(scope: string | null): ResolvedChatTheme {
  const s = useStore();
  const inApp = chatThemeSupported();
  const src = sourceOf(scope, s);
  const t = src.theme;
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!inApp || t.wallpaper !== "photo") {
      setPhotoUrl(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    void photoGet(src.key).then((blob) => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      setPhotoUrl(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [inApp, t.wallpaper, t.photoRev, src.key]);

  let wallpaperStyle: CSSProperties = {};
  if (inApp && t.wallpaper) {
    const overlay = `linear-gradient(rgba(0,0,0,${t.dim}), rgba(0,0,0,${t.dim}))`;
    if (t.wallpaper === "photo") {
      if (photoUrl) wallpaperStyle = { background: `${overlay}, url("${photoUrl}") center / cover no-repeat` };
    } else {
      const r = resolveTheme(t.wallpaper);
      if (r) wallpaperStyle = { background: `${overlay}, ${r.background}` };
    }
  }

  let bubbleStyle: CSSProperties | null = null;
  if (inApp && t.bubble) {
    const r = resolveTheme(t.bubble);
    // Les variables remplacent « primary-foreground » pour le texte, l'heure et les coches à l'intérieur de la bulle
    if (r) bubbleStyle = { background: r.background, color: r.color, ["--primary-foreground" as string]: r.color, ["--color-primary-foreground" as string]: r.color };
  }

  const fontStyle: CSSProperties = inApp && t.font ? { fontFamily: resolveFont(t.font) } : {};

  return { theme: t, hasOwn: scope !== null && !!s.chats[scope], wallpaperStyle, bubbleStyle, fontStyle };
}
