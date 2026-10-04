import { useQuery } from "@tanstack/react-query";

export const APK_URL = "/downloads/Kalchat.apk";

export interface ApkInfo {
  version: string;
  size: number;
  built_at: string;
}

/** Vrai si le site tourne déjà dans l'application Android (WebView Capacitor) : inutile de proposer l'APK. */
export function isInsideApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  return /; wv\)/.test(navigator.userAgent);
}

function isIOS(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Infos de l'APK publié sur le site, ou null s'il n'y en a pas (ou si on est dans l'appli / sur iPhone). */
export function useApkInfo(): ApkInfo | null {
  const hidden = isInsideApp() || isIOS();
  const q = useQuery({
    queryKey: ["apkInfo"],
    enabled: !hidden,
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<ApkInfo | null> => {
      const res = await fetch("/downloads/latest.json", { cache: "no-cache" });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as Partial<ApkInfo> | null;
      return data && typeof data.version === "string" ? { version: data.version, size: Number(data.size) || 0, built_at: String(data.built_at ?? "") } : null;
    },
  });
  return hidden ? null : (q.data ?? null);
}
