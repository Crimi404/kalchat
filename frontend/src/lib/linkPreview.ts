import { api } from "@/lib/api";

export interface LinkPreview {
  url: string;
  domain: string;
  title: string;
  description: string;
  site_name: string | null;
  /** Miniature déjà réduite par le serveur (data URL) : le téléphone ne contacte jamais le site externe. */
  image: string | null;
}

const URL_RE = /https?:\/\/[^\s<>]+/gi;
const OWN_HOSTS = ["kalchat.site"];

/** Première adresse externe d'un message (les liens kalchat.site n'ont pas de carte), ou null. */
export function firstExternalUrl(text: string): string | null {
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(/[.,;:!?)\]}»"']+$/, "");
    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      const host = u.hostname.toLowerCase();
      if (OWN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) continue;
      return u.toString();
    } catch {
      /* adresse invalide : on passe à la suivante */
    }
  }
  return null;
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  const r = await api<{ preview: LinkPreview | null }>(`/link-preview?url=${encodeURIComponent(url)}`);
  return r.preview;
}
