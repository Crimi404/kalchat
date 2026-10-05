import { api } from "@/lib/api";
import { isInsideApp } from "@/lib/apk";

type PermissionState = "prompt" | "prompt-with-rationale" | "granted" | "denied";

interface PushPlugin {
  checkPermissions: () => Promise<{ receive: PermissionState }>;
  requestPermissions: () => Promise<{ receive: PermissionState }>;
  register: () => Promise<void>;
  unregister?: () => Promise<void>;
  addListener: (event: string, cb: (data: any) => void) => Promise<{ remove: () => void }> | { remove: () => void }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const TOKEN_KEY = "kalchat_push_token";
const ASKED_KEY = "kalchat_push_asked";

/** Module natif de notifications (présent seulement dans l'APK compilée avec Firebase). */
export function pushPlugin(): PushPlugin | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: { PushNotifications?: PushPlugin } } }).Capacitor;
  return cap?.Plugins?.PushNotifications ?? null;
}

/** Vrai si on est dans l'application Android et qu'elle sait recevoir des notifications. */
export function pushAvailable(): boolean {
  return isInsideApp() && !!pushPlugin();
}

export function storedPushToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function pushAlreadyAsked(): boolean {
  try { return localStorage.getItem(ASKED_KEY) === "1"; } catch { return false; }
}

export function markPushAsked() {
  try { localStorage.setItem(ASKED_KEY, "1"); } catch { /* sans conséquence */ }
}

export async function pushPermission(): Promise<PermissionState | "unavailable"> {
  const p = pushPlugin();
  if (!p) return "unavailable";
  try { return (await p.checkPermissions()).receive; } catch { return "unavailable"; }
}

/** Demande un jeton à Firebase et attend sa réception. */
function fetchDeviceToken(p: PushPlugin): Promise<string> {
  return new Promise((resolve, reject) => {
    const handles: Array<{ remove: () => void }> = [];
    const done = () => handles.forEach((h) => h.remove());
    const timer = window.setTimeout(() => { done(); reject(new Error("Firebase ne répond pas, réessaie dans un instant")); }, 15000);
    void (async () => {
      try {
        handles.push(await p.addListener("registration", (t: { value: string }) => { window.clearTimeout(timer); done(); resolve(t.value); }));
        handles.push(await p.addListener("registrationError", (e: { error?: string }) => { window.clearTimeout(timer); done(); reject(new Error(e?.error || "Enregistrement impossible")); }));
        await p.register();
      } catch (err) {
        window.clearTimeout(timer);
        done();
        reject(err instanceof Error ? err : new Error("Enregistrement impossible"));
      }
    })();
  });
}

/** Autorise (si besoin) et enregistre cet appareil auprès du serveur. Renvoie l'état final de l'autorisation. */
export async function enablePush(): Promise<"granted" | "denied"> {
  const p = pushPlugin();
  if (!p) throw new Error("Les notifications ne sont pas disponibles dans cette version de l'application");
  let state = (await p.checkPermissions()).receive;
  if (state !== "granted") state = (await p.requestPermissions()).receive;
  if (state !== "granted") return "denied";
  const token = await fetchDeviceToken(p);
  await api("/push/register", { method: "POST", body: { token } });
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* sans conséquence */ }
  return "granted";
}

/** Oublie cet appareil côté serveur (déconnexion ou désactivation). N'échoue jamais. */
export async function unregisterPush(): Promise<void> {
  const token = storedPushToken();
  if (!token) return;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* sans conséquence */ }
  try { await api("/push/unregister", { method: "POST", body: { token } }); } catch { /* le serveur nettoiera lui-même les jetons périmés */ }
}

export async function disablePush(): Promise<void> {
  await unregisterPush();
  try { await pushPlugin()?.unregister?.(); } catch { /* sans conséquence */ }
}
