import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { CommunityPhotoPicker } from "@/components/CommunityPhotoPicker";
import { MiniAvatar } from "@/components/MiniAvatar";
import { createCommunity, fetchCommunities, joinCommunity, type Community, type JoinMode } from "@/lib/communities";

function JoinButton({ c }: { c: Community }) {
  const qc = useQueryClient();
  const join = useMutation({
    mutationFn: () => joinCommunity(c.id),
    onSuccess: (r) => {
      toast.success(r.status === "pending" ? "Demande envoyée aux administrateurs" : "Tu as rejoint la communauté");
      void qc.invalidateQueries({ queryKey: ["communities"] });
      void qc.invalidateQueries({ queryKey: ["community", c.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (c.my_status === "pending") return <span className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground">Demande envoyée</span>;
  if (c.my_status === "active") return null;
  return (
    <button disabled={join.isPending} onClick={() => join.mutate()} className="brand-gradient shrink-0 rounded-full px-4 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60">
      {c.join_mode === "approval" && !c.invited_by ? "Demander" : "Rejoindre"}
    </button>
  );
}

function CommunityRow({ c }: { c: Community }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
      <Link to="/communaute/$id" params={{ id: c.id }} className="flex min-w-0 flex-1 items-center gap-3">
        <MiniAvatar url={c.avatar_url} name={c.name} size={48} group />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-foreground">{c.name}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3" /> {c.member_count} membre{c.member_count > 1 ? "s" : ""}
            {c.pending_count > 0 && <span className="ml-1 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-white">{c.pending_count} demande{c.pending_count > 1 ? "s" : ""}</span>}
          </span>
          {c.description && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{c.description}</span>}
        </span>
      </Link>
      <JoinButton c={c} />
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<JoinMode>("open");
  const [avatar, setAvatar] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => createCommunity({ name, description, join_mode: mode, avatar_url: avatar }),
    onSuccess: (c) => {
      toast.success("Communauté créée");
      void qc.invalidateQueries({ queryKey: ["communities"] });
      onDone();
      void navigate({ to: "/communaute/$id", params: { id: c.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const field = "w-full rounded-xl border border-border bg-secondary/60 px-3 py-2 text-sm outline-none focus:border-primary";
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-3">
      <p className="text-sm font-bold">Nouvelle communauté</p>
      <CommunityPhotoPicker url={avatar} name={name} onChange={setAvatar} />
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Nom (3 à 40 caractères)" className={field} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={3} placeholder="De quoi parle cette communauté ?" className={field} />
      <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
        {([["open", "Ouverte", "Tout le monde peut rejoindre"], ["approval", "Sur validation", "Tu acceptes chaque membre"]] as const).map(([value, label, hint]) => (
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`rounded-xl border p-2.5 text-left ${mode === value ? "border-primary bg-primary/15" : "border-border bg-secondary/40"}`}>
            <span className="block text-sm">{label}</span>
            <span className="font-normal text-muted-foreground">{hint}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={onDone} className="flex-1 rounded-full border border-border py-2 text-sm font-semibold hover:bg-secondary">Annuler</button>
        <button disabled={create.isPending || name.trim().length < 3} onClick={() => create.mutate()} className="brand-gradient flex flex-1 items-center justify-center gap-2 rounded-full py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Créer
        </button>
      </div>
    </div>
  );
}

/** Onglet « Communautés » de l'accueil : mes communautés, découverte, création. */
export function CommunitiesTab() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const list = useQuery({ queryKey: ["communities", q], queryFn: () => fetchCommunities(q) });

  const mine = (list.data ?? []).filter((c) => c.my_status === "active");
  const others = (list.data ?? []).filter((c) => c.my_status !== "active");

  return (
    <div className="space-y-4 px-4 py-3">
      {creating ? (
        <CreateForm onDone={() => setCreating(false)} />
      ) : (
        <button onClick={() => setCreating(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/50 bg-primary/5 py-3 text-sm font-bold text-primary">
          <Plus className="h-4 w-4" /> Créer une communauté
        </button>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une communauté…" className="w-full rounded-full border border-border bg-secondary/60 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary" />
      </div>
      {list.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : list.isError ? (
        <p className="py-10 text-center text-sm text-destructive">Impossible de charger les communautés.</p>
      ) : !list.data?.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{q ? "Aucune communauté trouvée." : "Aucune communauté pour le moment. Crée la première !"}</p>
      ) : (
        <>
          {mine.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mes communautés</p>
              {mine.map((c) => <CommunityRow key={c.id} c={c} />)}
            </section>
          )}
          {others.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Découvrir</p>
              {others.map((c) => <CommunityRow key={c.id} c={c} />)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
