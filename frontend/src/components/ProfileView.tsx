import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Bookmark, CalendarDays, Flag, Grid3x3, Loader2, MapPin, Pencil, Settings, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { blockUser, unblockUser } from "@/lib/settings";
import { BadgeList } from "@/components/KalBadge";
import { PostCard } from "@/components/PostCard";
import { ReportSheet } from "@/components/ReportSheet";
import { publicUrl, shareLink } from "@/lib/share";
import { useAuth } from "@/lib/auth";
import { uploadMedia } from "@/lib/media";
import { getOrCreateConversation } from "@/lib/chat";
import {
  fetchFollowList,
  fetchProfileByUsername,
  fetchSavedPosts,
  fetchUserPosts,
  toggleFollow,
  updateMyProfile,
  type ProfileUpdate,
} from "@/lib/social";
import { Link, useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";

function FollowList({ username, kind, onClose }: { username: string; kind: "followers" | "following"; onClose: () => void }) {
  const q = useQuery({ queryKey: ["followList", username, kind], queryFn: () => fetchFollowList(username, kind) });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="animate-fade-in max-h-[75vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-card p-4 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-foreground">{kind === "followers" ? "Abonnés" : "Abonnements"}</h3>
          <button aria-label="Fermer" onClick={onClose} className="rounded-full p-1.5 hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        {q.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : !q.data?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Personne pour l'instant.</p>
        ) : (
          q.data.map((m) => (
            <Link key={m.id} to="/u/$username" params={{ username: m.username }} onClick={onClose} className="flex items-center gap-3 rounded-xl p-2 hover:bg-secondary">
              {m.avatar_url ? <img src={m.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-full font-bold text-primary-foreground">{m.display_name.slice(0, 1).toUpperCase()}</span>}
              <div className="min-w-0">
                <p className="flex items-center gap-1 truncate text-sm font-semibold text-foreground">{m.display_name}<BadgeList badges={m.badges} size={14} /></p>
                <p className="truncate text-xs text-muted-foreground">@{m.username}</p>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

export function ProfileView({ username }: { username: string }) {
  const { user, refresh } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [list, setList] = useState<"followers" | "following" | null>(null);
  const [tab, setTab] = useState<"posts" | "saved">("posts");
  const [reportOpen, setReportOpen] = useState(false);

  const profileQ = useQuery({ queryKey: ["profile", username], queryFn: () => fetchProfileByUsername(username) });
  const p = profileQ.data;
  const postsQ = useQuery({
    queryKey: ["userPosts", p?.id, user?.id],
    queryFn: () => fetchUserPosts(p!.id),
    enabled: !!p,
  });
  const isMeEarly = !!user && !!p && user.id === p.id;
  const savedQ = useQuery({
    queryKey: ["savedPosts", user?.id],
    queryFn: () => fetchSavedPosts(),
    enabled: isMeEarly && tab === "saved",
  });
  const navigate = useNavigate();
  const follow = useMutation({
    mutationFn: () => toggleFollow(p!.username, p!.relationship),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => toast.error(e.message),
  });
  const block = useMutation({
    mutationFn: (blocked: boolean) => (blocked ? unblockUser(p!.username) : blockUser(p!.username)),
    onSuccess: (_d, wasBlocked) => {
      toast.success(wasBlocked ? "Compte débloqué" : "Compte bloqué");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const openChat = useMutation({
    mutationFn: () => getOrCreateConversation(p!.id),
    onSuccess: (id) => navigate({ to: "/messages/$id", params: { id } }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (profileQ.isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!p) return <p className="py-20 text-center text-sm text-muted-foreground">Ce profil n'existe pas.</p>;

  const isMe = user?.id === p.id;
  const stats = p.stats;

  return (
    <div>
      {reportOpen && <ReportSheet type="user" targetId={p.id} onClose={() => setReportOpen(false)} />}
      <div className="relative h-36 bg-secondary">
        {p.cover_url ? <img src={p.cover_url} alt="Couverture" className="h-full w-full object-cover" /> : <div className="brand-gradient h-full w-full opacity-40" />}
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
      </div>
      <div className="-mt-12 px-4">
        <div className="flex items-end justify-between">
          <span className="story-ring relative z-10 rounded-full p-[3px]">
            {p.avatar_url ? (
              <img src={p.avatar_url} alt={p.display_name} className="h-24 w-24 rounded-full border-4 border-background object-cover" />
            ) : (
              <span className="brand-gradient flex h-24 w-24 items-center justify-center rounded-full border-4 border-background text-3xl font-bold text-primary-foreground">
                {p.display_name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </span>
          <div className="flex items-center gap-2 pb-2">
            <button
              aria-label="Partager le profil"
              onClick={() => void shareLink({ url: publicUrl(`/u/${p.username}`), title: `${p.display_name} sur Kalchat`, text: `Retrouve @${p.username} sur Kalchat` })}
              className="rounded-full border border-border bg-card p-2 hover:bg-secondary"
            >
              <Share2 className="h-4 w-4" />
            </button>
            {isMe ? (
              <div className="flex items-center gap-2">
                <Link to="/parametres" aria-label="Paramètres" className="rounded-full border border-border bg-card p-2 hover:bg-secondary">
                  <Settings className="h-4 w-4" />
                </Link>
                <button onClick={() => setEditing((v) => !v)} className="flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-secondary">
                  <Pencil className="h-4 w-4" /> Modifier
                </button>
              </div>
            ) : user && p.blockedByMe ? (
              <button
                disabled={block.isPending}
                onClick={() => block.mutate(true)}
                className="rounded-full border border-border bg-card px-5 py-2 text-sm font-bold text-foreground hover:bg-secondary disabled:opacity-60"
              >
                Débloquer
              </button>
            ) : user && p.blockedMe ? null : user ? (
              <div className="flex items-center gap-2">
                <button
                  aria-label={`Bloquer @${p.username}`}
                  disabled={block.isPending}
                  onClick={() => { if (window.confirm(`Bloquer @${p.username} ? Cette personne ne pourra plus te suivre, t'écrire ni te notifier, et vos abonnements seront supprimés.`)) block.mutate(false); }}
                  className="rounded-full border border-border bg-card p-2 text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-60"
                >
                  <Ban className="h-4 w-4" />
                </button>
                <button
                  aria-label={`Signaler @${p.username}`}
                  onClick={() => setReportOpen(true)}
                  className="rounded-full border border-border bg-card p-2 text-muted-foreground hover:bg-secondary hover:text-destructive"
                >
                  <Flag className="h-4 w-4" />
                </button>
                {p.canMessage && (
                  <button
                    disabled={openChat.isPending}
                    onClick={() => openChat.mutate()}
                    className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-secondary disabled:opacity-60"
                  >
                    Message
                  </button>
                )}
                <button
                  disabled={follow.isPending}
                  onClick={() => follow.mutate()}
                  className={`rounded-full px-5 py-2 text-sm font-bold transition-transform active:scale-95 ${p.relationship === "none" ? "brand-gradient text-primary-foreground" : "border border-border bg-card text-foreground"}`}
                >
                  {p.relationship === "accepted" ? "Abonné" : p.relationship === "pending" ? "Demande envoyée" : "Suivre"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          <h2 className="text-xl font-bold text-foreground">{p.display_name}</h2>
          <BadgeList badges={p.badges} size={18} />
        </div>
        <p className="text-sm text-muted-foreground">@{p.username}</p>
        {p.is_suspended && <p className="mt-1 text-xs font-semibold text-destructive">Compte suspendu</p>}
        {p.bio && <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{p.bio}</p>}
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {p.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{p.location}</span>}
          <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Inscrit en {new Date(p.created_at).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</span>
        </div>
        <div className="mt-4 grid grid-cols-3 rounded-2xl border border-border bg-card py-3 text-center">
          <div>
            <p className="text-lg font-bold text-foreground">{stats?.posts ?? "–"}</p>
            <p className="text-[11px] text-muted-foreground">Publications</p>
          </div>
          <button onClick={() => setList("followers")} className="rounded-xl hover:bg-secondary">
            <p className="text-lg font-bold text-foreground">{stats?.followers ?? "–"}</p>
            <p className="text-[11px] text-muted-foreground">Abonnés</p>
          </button>
          <button onClick={() => setList("following")} className="rounded-xl hover:bg-secondary">
            <p className="text-lg font-bold text-foreground">{stats?.following ?? "–"}</p>
            <p className="text-[11px] text-muted-foreground">Abonnements</p>
          </button>
        </div>
        {list && <FollowList username={p.username} kind={list} onClose={() => setList(null)} />}
        {isMe && editing && (
          <EditProfile
            initial={p}
            onDone={async (newUsername) => {
              setEditing(false);
              await refresh();
              qc.invalidateQueries();
              if (newUsername !== username) window.location.assign(`/u/${newUsername}`);
            }}
          />
        )}
      </div>
      <div className="mt-4 border-t border-border">
        {isMe && (
          <div className="grid grid-cols-2 border-b border-border">
            {([
              { id: "posts", label: "Publications", Icon: Grid3x3 },
              { id: "saved", label: "Enregistrés", Icon: Bookmark },
            ] as const).map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center justify-center gap-1.5 py-3 text-sm font-semibold transition-colors ${tab === id ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        )}
        {isMe && tab === "saved" ? (
          savedQ.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : savedQ.data?.length ? (
            savedQ.data.map((post) => <PostCard key={post.id} post={post} />)
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Aucune publication enregistrée. Touche le signet sous un post pour le retrouver ici.</p>
          )
        ) : postsQ.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : postsQ.data?.length ? (
          postsQ.data.map((post) => <PostCard key={post.id} post={post} />)
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">Aucune publication pour l'instant.</p>
        )}
      </div>
    </div>
  );
}

function EditProfile({
  initial,
  onDone,
}: {
  initial: { id: string; username: string; first_name: string; last_name: string; bio: string; location: string | null };
  onDone: (username: string) => void;
}) {
  const [firstName, setFirstName] = useState(initial.first_name);
  const [lastName, setLastName] = useState(initial.last_name);
  const [bio, setBio] = useState(initial.bio);
  const [location, setLocation] = useState(initial.location ?? "");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const field = "w-full rounded-xl border border-border bg-secondary/60 px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

  async function save() {
    if (!firstName.trim() || !lastName.trim()) { toast.error("Prénom et nom requis"); return; }
    if (bio.length > 300) { toast.error("Bio : 300 caractères max"); return; }
    setSaving(true);
    try {
      const patch: ProfileUpdate = { first_name: firstName.trim(), last_name: lastName.trim(), bio, location: location.trim() };
      if (avatar) patch.avatar_url = (await uploadMedia(avatar, { maxSide: 640 })).url;
      if (cover) patch.cover_url = (await uploadMedia(cover)).url;
      await updateMyProfile(patch);
      toast.success("Profil mis à jour");
      onDone(initial.username);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animate-fade-in mt-4 space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex gap-2">
        <input className={field} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" maxLength={30} />
        <input className={field} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom" maxLength={30} />
      </div>
      <textarea className={field} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Bio" rows={3} maxLength={300} />
      <input className={field} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ville" maxLength={60} />
      <label className="block text-xs text-muted-foreground">Photo de profil
        <input type="file" accept="image/*" onChange={(e) => setAvatar(e.target.files?.[0] ?? null)} className="mt-1 block text-xs" />
      </label>
      <label className="block text-xs text-muted-foreground">Image de couverture
        <input type="file" accept="image/*" onChange={(e) => setCover(e.target.files?.[0] ?? null)} className="mt-1 block text-xs" />
      </label>
      <button onClick={save} disabled={saving} className="brand-gradient w-full rounded-xl py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60">
        {saving ? "Enregistrement…" : "Enregistrer"}
      </button>
    </div>
  );
}
