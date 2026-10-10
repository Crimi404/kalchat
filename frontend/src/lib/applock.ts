import { useSyncExternalStore } from "react";
import { isInsideApp } from "@/lib/apk";

/**
 * Verrouillage de Kalchat (APK uniquement) : code PIN + empreinte digitale.
 * - mode « app » : toute l'application est verrouillée ;
 * - mode « messages » : seule la messagerie (/messages…) est verrouillée.
 * Les réglages restent sur le téléphone (ils ne sont pas envoyés au serveur). Le code PIN n'est jamais gardé en clair.
 */
export type LockMode = "off" | "app" | "messages";
export type LockDelay = 0 | 60 | 300 | 900; // secondes passées hors de l'appli avant de redemander le code

export const LOCK_DELAYS: { value: LockDelay; label: string }[] = [
  { value: 0, label: "Immédiatement" },
  { value: 60, label: "Après 1 minute" },
  { value: 300, label: "Après 5 minutes" },
  { value: 900, label: "Après 15 minutes" },
];

export const PIN_LENGTH = 4;

interface LockConfig {
  mode: LockMode;
  pinHash: string | null;
  salt: string | null;
  biometric: boolean;
  delay: LockDelay;
}

const CONFIG_KEY = "kalchat_lock_v1";
const FAILS_KEY = "kalchat_lock_fails_v1";
const DEFAULT_CONFIG: LockConfig = { mode: "off", pinHash: null, salt: null, biometric: false, delay: 0 };

function readConfig(): LockConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const c = JSON.parse(raw) as Partial<LockConfig>;
    const mode: LockMode = c.mode === "app" || c.mode === "messages" ? c.mode : "off";
    const delay: LockDelay = c.delay === 60 || c.delay === 300 || c.delay === 900 ? c.delay : 0;
    // Sans code PIN, pas de verrouillage
    if (!c.pinHash || !c.salt) return { ...DEFAULT_CONFIG };
    return { mode, pinHash: c.pinHash, salt: c.salt, biometric: !!c.biometric, delay };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(c: LockConfig) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {
    /* stockage indisponible : le verrouillage ne sera pas conservé */
  }
}

// ---------- État partagé (config + « verrouillé maintenant ? ») ----------
interface LockState {
  config: LockConfig;
  locked: boolean;
}

let state: LockState = (() => {
  const config = typeof window === "undefined" ? { ...DEFAULT_CONFIG } : readConfig();
  return { config, locked: config.mode !== "off" }; // à l'ouverture de l'appli, on demande le code
})();

const listeners = new Set<() => void>();

function setState(next: LockState) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useAppLock(): LockState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function lockSupported(): boolean {
  return isInsideApp();
}

// ---------- Code PIN ----------
function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPin(pin: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 120_000, hash: "SHA-256" }, key, 256);
  return toHex(bits);
}

function newSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

/** Enregistre un nouveau code PIN (remplace l'ancien). */
export async function setPin(pin: string) {
  const salt = newSalt();
  const pinHash = await hashPin(pin, salt);
  setState({ ...state, config: { ...state.config, pinHash, salt } });
  writeConfig(state.config);
  resetFails();
}

// Après plusieurs essais ratés, on fait patienter (30 s, puis le double à chaque erreur, 15 min au maximum)
interface Fails {
  count: number;
  until: number;
}

function readFails(): Fails {
  try {
    const f = JSON.parse(localStorage.getItem(FAILS_KEY) || "null") as Fails | null;
    return f && typeof f.count === "number" && typeof f.until === "number" ? f : { count: 0, until: 0 };
  } catch {
    return { count: 0, until: 0 };
  }
}

function writeFails(f: Fails) {
  try {
    localStorage.setItem(FAILS_KEY, JSON.stringify(f));
  } catch {
    /* sans conséquence */
  }
}

function resetFails() {
  writeFails({ count: 0, until: 0 });
}

/** Secondes à attendre avant de pouvoir réessayer (0 = on peut essayer). */
export function waitSeconds(): number {
  return Math.max(0, Math.ceil((readFails().until - Date.now()) / 1000));
}

export type PinCheck = { ok: true } | { ok: false; wait: number };

/** Vérifie un code PIN, avec limitation des essais. */
export async function checkPin(pin: string): Promise<PinCheck> {
  const wait = waitSeconds();
  if (wait > 0) return { ok: false, wait };
  const { pinHash, salt } = state.config;
  if (!pinHash || !salt) return { ok: false, wait: 0 };
  if ((await hashPin(pin, salt)) === pinHash) {
    resetFails();
    return { ok: true };
  }
  const count = readFails().count + 1;
  const penalty = count >= 5 ? Math.min(900, 30 * 2 ** (count - 5)) : 0;
  writeFails({ count, until: penalty ? Date.now() + penalty * 1000 : 0 });
  return { ok: false, wait: penalty };
}

// ---------- Réglages ----------
export function updateLock(patch: Partial<Pick<LockConfig, "mode" | "biometric" | "delay">>) {
  const config = { ...state.config, ...patch };
  if (!config.pinHash) config.mode = "off";
  setState({ config, locked: config.mode === "off" ? false : state.locked });
  writeConfig(config);
}

/** Supprime tout (déconnexion, code oublié). */
export function clearAppLock() {
  try {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(FAILS_KEY);
  } catch {
    /* sans conséquence */
  }
  setState({ config: { ...DEFAULT_CONFIG }, locked: false });
}

export function unlockApp() {
  setState({ ...state, locked: false });
}

export function lockNow() {
  if (state.config.mode !== "off") setState({ ...state, locked: true });
}

// ---------- Retour dans l'appli : on reverrouille après le délai choisi ----------
let hiddenAt = 0;
let ignoreResumeUntil = 0;

/** À appeler autour de l'invite d'empreinte : elle fait passer l'appli un instant en arrière-plan, sans que ça compte. */
export function pauseRelock(ms = 60_000) {
  ignoreResumeUntil = Date.now() + ms;
}

function onHidden() {
  if (Date.now() < ignoreResumeUntil) return;
  hiddenAt = Date.now();
}

function onVisible() {
  if (!hiddenAt) return;
  const away = Date.now() - hiddenAt;
  hiddenAt = 0;
  if (Date.now() < ignoreResumeUntil) return;
  if (state.config.mode !== "off" && away >= state.config.delay * 1000) lockNow();
}

type AppPlugin = { addListener: (e: "appStateChange", cb: (s: { isActive: boolean }) => void) => unknown };

if (typeof window !== "undefined") {
  const cap = (window as unknown as { Capacitor?: { Plugins?: { App?: AppPlugin } } }).Capacitor;
  const App = cap?.Plugins?.App;
  if (App) {
    void App.addListener("appStateChange", (s) => (s.isActive ? onVisible() : onHidden()));
  } else {
    document.addEventListener("visibilitychange", () => (document.visibilityState === "hidden" ? onHidden() : onVisible()));
  }
  window.addEventListener("kalchat:logout", clearAppLock);
}

// ---------- Empreinte digitale (plugin natif, présent seulement dans l'APK compilée avec) ----------
interface BiometricPlugin {
  isAvailable: (o?: { useFallback?: boolean }) => Promise<{ isAvailable: boolean }>;
  verifyIdentity: (o: { reason?: string; title?: string; subtitle?: string; description?: string; negativeButtonText?: string; maxAttempts?: number }) => Promise<void>;
}

function biometricPlugin(): BiometricPlugin | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: { NativeBiometric?: BiometricPlugin }; registerPlugin?: (n: string) => BiometricPlugin } }).Capacitor;
  return cap?.Plugins?.NativeBiometric ?? cap?.registerPlugin?.("NativeBiometric") ?? null;
}

/** Le téléphone a-t-il une empreinte / un visage enregistré, et l'APK sait-elle l'utiliser ? */
export async function biometricAvailable(): Promise<boolean> {
  try {
    const plugin = biometricPlugin();
    if (!plugin) return false;
    return !!(await plugin.isAvailable({ useFallback: false })).isAvailable;
  } catch {
    return false;
  }
}

/** Demande l'empreinte. Renvoie true si elle est reconnue. */
export async function verifyBiometric(reason: string): Promise<boolean> {
  const plugin = biometricPlugin();
  if (!plugin) return false;
  pauseRelock();
  try {
    await plugin.verifyIdentity({ reason, title: "Kalchat", subtitle: reason, negativeButtonText: "Utiliser le code PIN", maxAttempts: 3 });
    return true;
  } catch {
    return false;
  } finally {
    pauseRelock(1500);
  }
}
