import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Loader2, Search, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { MiniAvatar } from "@/components/MiniAvatar";
import { copyLink, publicUrl, shareLink } from "@/lib/share";
import { inviteToCommunity, memberDisplayName, searchInvitees, type Community, type InviteCandidate } from "@/lib/communities";

function CandidateRow({ c, user }: { c: Community; user: InviteCandidate }) {
  const qc = useQueryClient();
  const invite = useMutation({
    mutationFn: () => inviteToCommunity(c.id, user.id),
    onSuccess: (r) => {
      toast.success(r.status === "approved" ? "Demande acceptée : le membre a rejoint la communauté" : "Invitation envoyée");
      void qc.invalidateQueries({ queryKey: ["inviteSearch", c.id] });
      void qc.invalidateQueries({ queryKey: ["community", c.id] });
      void qc.invalidateQueries({ queryKey: ["communityMembers", c.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  let label = "Inviter";
  let disabled = invite.isPending;
  if (user.member_status === "active") { label = "Déjà membre"; disabled = true; }
  else if (user.member_status === "pending") label = "Accepter la demande";
  else if (user.invited) { label = "Invité ✓"; disabled = true; }
  return (
    <div className="flex items-center gap-3 py-2">
      <MiniAvatar url={user.avatar_url} name={memberDisplayName(user)} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{memberDisplayName(user)}</p>
        <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
      </div>
      <button disabled={disabled} onClick={() => invite.mutate()} className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-60 ${disabled ? "border border-border text-muted-foreground" : "brand-gradient text-primary-foreground"}`}>
        {invite.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : label}
      </button>
    </div>
  );
}

/** Inviter des membres dans une communauté : par recherche (notification envoyée) ou en partageant le lien. */
export function InviteSheet({ community, onClose }: { community: Community; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const results = useQuery({ queryKey: ["inviteSearch", community.id, q], queryFn: () => searchInvitees(community.id, q), enabled: q.length >= 2 });
  const url = publicUrl(`/communaute/${community.id}`);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-3xl border border-border bg-card p-4 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-bold text-foreground">Inviter dans « {community.name} »</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {community.join_mode === "approval" ? "Les membres invités rejoignent directement, sans attendre ta validation." : "Les membres invités reçoivent une notification et rejoignent en un tap."}
            </p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => void shareLink({ url, title: `Rejoins ${community.name} sur Kalchat`, text: `Je t'invite à rejoindre la communauté « ${community.name} » sur Kalchat` })} className="brand-gradient flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold text-primary-foreground">
            <Share2 className="h-4 w-4" /> Partager le lien
          </button>
          <button onClick={() => void copyLink(url)} className="flex items-center justify-center gap-2 rounded-full border border-border py-2.5 text-sm font-semibold hover:bg-secondary">
            <Link2 className="h-4 w-4" /> Copier le lien
          </button>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chercher un membre à inviter…" className="w-full rounded-full border border-border bg-secondary/60 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary" />
        </div>

        <div className="mt-2 min-h-[120px] flex-1 overflow-y-auto">
          {q.length < 2 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Tape au moins 2 lettres du pseudo ou du nom.</p>
          ) : results.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : results.isError ? (
            <p className="py-8 text-center text-xs text-destructive">{(results.error as Error).message}</p>
          ) : !results.data?.length ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Aucun membre trouvé.</p>
          ) : (
            results.data.map((u) => <CandidateRow key={u.id} c={community} user={u} />)
          )}
        </div>
      </div>
    </div>
  );
}
