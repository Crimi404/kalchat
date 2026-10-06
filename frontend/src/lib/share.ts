import { toast } from "sonner";

// Adresse publique de l'application, utilisée si l'app tourne depuis un contexte sans adresse web (ex. fichier local)
const PUBLIC_URL = "https://kalchat.site";

export function publicUrl(path: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const usable = /^https?:\/\//.test(origin) && !/localhost|127\.0\.0\.1/.test(origin);
  return `${usable ? origin : PUBLIC_URL}${path}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export async function copyLink(url: string) {
  if (await copyText(url)) toast.success("Lien copié");
  else toast.error("Impossible de copier le lien");
}

/** Ouvre le partage du téléphone s'il existe, sinon copie le lien. */
export async function shareLink(input: { url: string; title?: string; text?: string }) {
  // Dans l'appli Android (Capacitor) : vrai menu de partage du téléphone (WhatsApp, Telegram, etc.)
  type SharePlugin = { share: (o: { title?: string; text?: string; url?: string; dialogTitle?: string }) => Promise<unknown> };
  const cap = (typeof window !== "undefined"
    ? (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { Share?: SharePlugin }; registerPlugin?: (n: string) => SharePlugin } }).Capacitor
    : undefined);
  if (cap?.isNativePlatform?.()) {
    try {
      const plugin = cap.Plugins?.Share ?? cap.registerPlugin?.("Share");
      if (plugin) {
        await plugin.share({ title: input.title, text: input.text, url: input.url, dialogTitle: "Partager" });
        return;
      }
    } catch (e) {
      if (/cancel/i.test(String((e as Error)?.message ?? e))) return; // l'utilisateur a fermé le partage
    }
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ url: input.url, title: input.title, text: input.text });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // l'utilisateur a fermé le partage
    }
  }
  await copyLink(input.url);
}

// ---------- Retour vers la page demandée après connexion (liens partagés) ----------
const AFTER_LOGIN_KEY = "kalchat_after_login";

export function rememberDestination(href: string) {
  try {
    if (href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/auth")) sessionStorage.setItem(AFTER_LOGIN_KEY, href);
  } catch { /* stockage indisponible */ }
}

export function takeDestination(): string | null {
  try {
    const v = sessionStorage.getItem(AFTER_LOGIN_KEY);
    sessionStorage.removeItem(AFTER_LOGIN_KEY);
    return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/auth") ? v : null;
  } catch {
    return null;
  }
}
