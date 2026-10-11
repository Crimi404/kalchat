import { useSyncExternalStore } from "react";

/** Lecture automatique des vidéos du fil : jamais, seulement en Wi-Fi (par défaut, pour ne pas consommer les données mobiles) ou toujours. */
export type AutoplayMode = "wifi" | "always" | "never";

const AUTOPLAY_KEY = "kalchat:feedAutoplay";
const SHORTS_AUTOSCROLL_KEY = "kalchat:shortsAutoScroll";
const CHANGE_EVENT = "kalchat:prefs-changed";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : le réglage vaut pour cette session seulement */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function getAutoplayMode(): AutoplayMode {
  const v = read(AUTOPLAY_KEY);
  return v === "always" || v === "never" ? v : "wifi";
}
export function setAutoplayMode(mode: AutoplayMode) {
  write(AUTOPLAY_KEY, mode);
}

export function getShortsAutoScroll(): boolean {
  return read(SHORTS_AUTOSCROLL_KEY) === "1";
}
export function setShortsAutoScroll(on: boolean) {
  write(SHORTS_AUTOSCROLL_KEY, on ? "1" : "0");
}

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useAutoplayMode(): AutoplayMode {
  return useSyncExternalStore(subscribe, getAutoplayMode, () => "wifi" as AutoplayMode);
}
export function useShortsAutoScroll(): boolean {
  return useSyncExternalStore(subscribe, getShortsAutoScroll, () => false);
}

interface NetInfo {
  type?: string;
  effectiveType?: string;
  saveData?: boolean;
}

/** Vrai si la connexion actuelle n'est pas un forfait mobile (Wi-Fi ou câble). Si le téléphone ne le dit pas, on ne bloque pas. */
export function onUnmeteredConnection(): boolean {
  const c = (navigator as unknown as { connection?: NetInfo }).connection;
  if (!c) return true;
  if (c.saveData) return false;
  if (c.type) return c.type !== "cellular" && c.type !== "none";
  return c.effectiveType !== "slow-2g" && c.effectiveType !== "2g";
}

/** Faut-il lancer automatiquement les vidéos du fil, avec ce réglage et la connexion du moment ? */
export function shouldAutoplay(mode: AutoplayMode): boolean {
  if (mode === "never") return false;
  if (mode === "always") return true;
  return onUnmeteredConnection();
}
