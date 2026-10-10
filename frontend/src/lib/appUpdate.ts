import { useEffect, useState } from "react";
import { isInsideApp } from "@/lib/apk";

/** Nombre de jours pendant lesquels la mise à jour reste facultative, à partir de la sortie de la nouvelle version. */
export const UPDATE_GRACE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AppUpdate {
  /** Version publiée sur le site (ex. « 1.0.7 »). */
  latest: string;
  /** Version installée sur le téléphone. */
  current: string;
  /** Jours restants avant le blocage (0 = bloquée). */
  daysLeft: number;
  /** Vrai : l'appli est bloquée tant que la mise à jour n'est pas faite. */
  blocking: boolean;
}

type AppPlugin = { getInfo?: () => Promise<{ version?: string }> };

function nativeApp(): AppPlugin | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: { App?: AppPlugin } } }).Capacitor;
  return cap?.Plugins?.App ?? null;
}

/** Compare deux numéros de version « 1.0.6 » : > 0 si a est plus récente que b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Mise à jour de l'APK (dans l'appli uniquement) :
 * - nouvelle version publiée -> message facultatif pendant UPDATE_GRACE_DAYS jours (compte à rebours),
 * - ensuite l'appli est bloquée jusqu'à la mise à jour,
 * - « force: true » dans /downloads/latest.json bloque tout de suite (correctif urgent).
 * Hors connexion (ou ancienne APK sans le module), rien n'est affiché : on ne bloque jamais quelqu'un qui est hors ligne.
 */
export function useAppUpdate(): AppUpdate | null {
  const [update, setUpdate] = useState<AppUpdate | null>(null);

  useEffect(() => {
    if (!isInsideApp()) return;
    const App = nativeApp();
    if (!App?.getInfo) return;
    let cancelled = false;

    const check = async () => {
      try {
        const [info, res] = await Promise.all([App.getInfo!(), fetch("/downloads/latest.json", { cache: "no-cache" })]);
        if (!res.ok || !info?.version) return;
        const data = (await res.json()) as { version?: string; built_at?: string; force?: boolean };
        if (!data?.version || compareVersions(data.version, info.version) <= 0) {
          if (!cancelled) setUpdate(null);
          return;
        }
        const released = Date.parse(data.built_at ?? "");
        const elapsedDays = Number.isFinite(released) ? Math.max(0, Math.floor((Date.now() - released) / DAY_MS)) : 0;
        const daysLeft = Math.max(0, UPDATE_GRACE_DAYS - elapsedDays);
        const blocking = data.force === true || daysLeft === 0;
        if (!cancelled) setUpdate({ latest: data.version, current: info.version, daysLeft, blocking });
      } catch {
        /* hors ligne ou réponse invalide : aucun message, aucun blocage */
      }
    };

    void check();
    // Revérifie quand l'appli revient au premier plan
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return update;
}
