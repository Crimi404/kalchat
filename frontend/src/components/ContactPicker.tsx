import { Check, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BadgeList } from "@/components/KalBadge";
import { MiniAvatar } from "@/components/MiniAvatar";
import type { MiniProfile } from "@/lib/social";

/**
 * Liste de tes amis (abonnement accepté) avec barre de recherche.
 * - multi=false : un clic sur un ami appelle onPick (ex. démarrer une discussion)
 * - multi=true  : un clic coche / décoche (ex. choisir les membres d'un groupe)
 */
export function ContactPicker({
  contacts,
  loading,
  multi = false,
  selectedIds,
  excludeIds,
  onPick,
  onToggle,
  onNavigate,
}: {
  contacts: MiniProfile[] | undefined;
  loading: boolean;
  multi?: boolean;
  selectedIds?: Set<string>;
  excludeIds?: Set<string>;
  onPick?: (c: MiniProfile) => void;
  onToggle?: (c: MiniProfile) => void;
  onNavigate?: () => void;
}) {
  const [term, setTerm] = useState("");

  const list = useMemo(() => {
    const base = (contacts ?? []).filter((c) => !excludeIds?.has(c.id));
    const t = term.trim().toLowerCase();
    if (!t) return base;
    return base.filter((c) => c.display_name.toLowerCase().includes(t) || c.username.toLowerCase().includes(t));
  }, [contacts, excludeIds, term]);

  const totalAvailable = (contacts ?? []).filter((c) => !excludeIds?.has(c.id)).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-2 focus-within:border-primary">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Rechercher un ami…"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : totalAvailable === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-semibold text-foreground">Aucun ami disponible pour l'instant</p>
            <p className="mt-1 text-xs text-muted-foreground">Abonne-toi à des membres : dès qu'ils acceptent ta demande, ils apparaissent ici.</p>
            <Link to="/explorer" onClick={onNavigate} className="brand-gradient mt-4 inline-block rounded-full px-4 py-2 text-xs font-bold text-primary-foreground">Trouver des membres</Link>
          </div>
        ) : list.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Aucun résultat pour « {term} ».</p>
        ) : (
          list.map((c) => {
            const checked = !!selectedIds?.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => (multi ? onToggle?.(c) : onPick?.(c))}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-secondary"
              >
                <MiniAvatar url={c.avatar_url} name={c.display_name} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-sm font-semibold text-foreground"><span className="truncate">{c.display_name}</span><BadgeList badges={c.badges} size={14} /></span>
                  <span className="block truncate text-xs text-muted-foreground">@{c.username}</span>
                </span>
                {multi && (
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                    {checked && <Check className="h-3.5 w-3.5" />}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
