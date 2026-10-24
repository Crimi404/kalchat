import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { fetchLinkPreview, firstExternalUrl } from "@/lib/linkPreview";

/**
 * Carte d'aperçu sous un message qui contient un lien externe.
 * Rien ne s'affiche tant qu'il n'y a pas de métadonnées exploitables : le message reste exactement comme avant.
 * Tous les textes sont affichés comme du texte (jamais en HTML).
 */
export function LinkPreviewCard({ text }: { text: string }) {
  const url = useMemo(() => firstExternalUrl(text), [text]);
  const q = useQuery({
    queryKey: ["linkPreview", url],
    queryFn: () => fetchLinkPreview(url!),
    enabled: !!url,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
  const p = q.data;
  if (!url || !p || !p.title) return null;
  const image = p.image && p.image.startsWith("data:image/") ? p.image : null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="mt-2 block w-64 max-w-full overflow-hidden rounded-xl border border-border/60 bg-background/80 text-left text-foreground no-underline shadow-sm transition-opacity active:opacity-80"
    >
      {image && <img src={image} alt="" draggable={false} className="max-h-40 w-full object-cover" />}
      <span className="block space-y-0.5 px-3 py-2">
        <span className="line-clamp-2 block text-[13px] font-bold leading-snug">{p.title}</span>
        {p.description && <span className="line-clamp-2 block text-xs leading-snug text-muted-foreground">{p.description}</span>}
        <span className="flex items-center gap-1 pt-0.5 text-[11px] text-muted-foreground">
          <Globe className="h-3 w-3 shrink-0" />
          <span className="truncate">{p.domain}</span>
        </span>
      </span>
    </a>
  );
}
