import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Camera, Copy, Link2, Loader2, LogOut, RefreshCw, Share2, UserMinus, UserPlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BadgeList } from "@/components/KalBadge";
import { ContactPicker } from "@/components/ContactPicker";
import { MiniAvatar } from "@/components/MiniAvatar";
import { addGroupMembers, createGroupInvite, fetchContacts, fetchGroupInvite, removeGroupMember, revokeGroupInvite, updateGroup, type ConversationDetail } from "@/lib/chat";
import { copyLink, publicUrl, shareLink } from "@/lib/share";
import { uploadMedia } from "@/lib/media";
import type { MiniProfile } from "@/lib/social";
import { useBackHandler } from "@/lib/back";

/** Infos d'un groupe : membres, ajout / retrait (administrateurs), nom, photo, quitter. */
export function GroupInfoSheet({ detail, myId, onClose }: { detail: ConversationDetail; myId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<MiniProfile[]>([]);
  const [name, setName] = useState(detail.name);

  const memberIds = useMemo(() => new Set(detail.members.map((m) => m.id)), [detail.members]);
  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);
  useBackHandler(() => (adding ? (setAdding(false), setPicked([])) : onClose()));
  const contactsQ = useQuery({ queryKey: ["contacts"], queryFn: fetchContacts, enabled: adding });
  const inviteQ = useQuery({ queryKey: ["groupInvite", detail.id], queryFn: () => fetchGroupInvite(detail.id), enabled: detail.myIsAdmin });
  const inviteUrl = inviteQ.data ? publicUrl(`/groupe/${inviteQ.data}`) : null;
  const makeInvite = useMutation({
    mutationFn: () => createGroupInvite(detail.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["groupInvite", detail.id] }); toast.success("Lien d'invitation prêt"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const stopInvite = useMutation({
    mutationFn: () => revokeGroupInvite(detail.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["groupInvite", detail.id] }); toast.success("Lien désactivé"); },
    onError: (e: Error) => toast.error(e.message),
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["conversation", detail.id] });
    void qc.invalidateQueries({ queryKey: ["messages", detail.id] });
    void qc.invalidateQueries({ queryKey: ["conversations"] });
  }

  const rename = useMutation({
    mutationFn: () => updateGroup(detail.id, { name: name.trim() }),
    onSuccess: () => { toast.success("Nom du groupe mis à jour"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const changePhoto = useMutation({
    mutationFn: async (f: File) => updateGroup(detail.id, { avatar_url: (await uploadMedia(f, { maxSide: 640 })).url }),
    onSuccess: () => { toast.success("Photo du groupe mise à jour"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const add = useMutation({
    mutationFn: () => addGroupMembers(detail.id, picked.map((p) => p.id)),
    onSuccess: () => { toast.success("Membres ajoutés"); setPicked([]); setAdding(false); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removeGroupMember(detail.id, userId),
    onSuccess: () => { toast.success("Membre retiré"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const leave = useMutation({
    mutationFn: () => removeGroupMember(detail.id, myId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["unread"] });
      onClose();
      void navigate({ to: "/messages" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function togglePicked(c: MiniProfile) {
    setPicked((prev) => (prev.some((p) => p.id === c.id) ? prev.filter((p) => p.id !== c.id) : [...prev, c]));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="animate-fade-in flex h-[85vh] w-full max-w-md flex-col rounded-t-3xl border border-border bg-card sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-3">
          <button aria-label={adding ? "Retour" : "Fermer"} onClick={() => (adding ? (setAdding(false), setPicked([])) : onClose())} className="rounded-full p-2 hover:bg-secondary">
            {adding ? <ArrowLeft className="h-5 w-5" /> : <X className="h-5 w-5" />}
          </button>
          <h3 className="flex-1 font-bold text-foreground">{adding ? "Ajouter des membres" : "Infos du groupe"}</h3>
        </div>

        {adding ? (
          <>
            <ContactPicker contacts={contactsQ.data} loading={contactsQ.isLoading} multi excludeIds={memberIds} selectedIds={pickedIds} onToggle={togglePicked} onNavigate={onClose} />
            <div className="border-t border-border p-3">
              <button disabled={picked.length < 1 || add.isPending} onClick={() => add.mutate()} className="brand-gradient flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {add.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {picked.length < 1 ? "Choisis au moins un ami" : `Ajouter (${picked.length})`}
              </button>
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
            <div className="flex flex-col items-center gap-3 pb-4">
              <label className={`relative ${detail.myIsAdmin ? "cursor-pointer" : ""}`}>
                <MiniAvatar url={detail.avatar_url} name={detail.name} size={88} group />
                {detail.myIsAdmin && (
                  <>
                    <span className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground">
                      {changePhoto.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    </span>
                    <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) changePhoto.mutate(f); e.target.value = ""; }} />
                  </>
                )}
              </label>
              {detail.myIsAdmin ? (
                <div className="flex w-full items-center gap-2">
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} className="w-full rounded-xl border border-border bg-secondary/60 px-3 py-2 text-center text-sm font-bold text-foreground outline-none focus:border-primary" />
                  {name.trim() && name.trim() !== detail.name && (
                    <button disabled={rename.isPending} onClick={() => rename.mutate()} className="brand-gradient shrink-0 rounded-xl px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60">OK</button>
                  )}
                </div>
              ) : (
                <h4 className="text-lg font-bold text-foreground">{detail.name}</h4>
              )}
              <p className="text-xs text-muted-foreground">Groupe · {detail.members.length} membre{detail.members.length > 1 ? "s" : ""}</p>
            </div>

            {detail.myIsAdmin && (
              <button onClick={() => setAdding(true)} className="mb-2 flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-colors hover:bg-secondary">
                <span className="brand-gradient flex h-11 w-11 items-center justify-center rounded-full text-primary-foreground"><UserPlus className="h-5 w-5" /></span>
                <span className="text-sm font-bold text-foreground">Ajouter des membres</span>
              </button>
            )}

            {detail.myIsAdmin && (
              <div className="mb-3 rounded-2xl border border-border p-3">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground"><Link2 className="h-4 w-4" /> Lien d'invitation</div>
                {inviteQ.isLoading ? (
                  <Loader2 className="mt-2 h-4 w-4 animate-spin text-primary" />
                ) : inviteUrl ? (
                  <>
                    <p className="mt-2 break-all rounded-xl bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">{inviteUrl}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button onClick={() => void copyLink(inviteUrl)} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary"><Copy className="h-3.5 w-3.5" /> Copier</button>
                      <button onClick={() => void shareLink({ url: inviteUrl, title: detail.name, text: `Rejoins le groupe « ${detail.name} » sur Kalchat` })} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary"><Share2 className="h-3.5 w-3.5" /> Partager</button>
                      <button disabled={makeInvite.isPending} onClick={() => { if (window.confirm("Générer un nouveau lien ? L'ancien ne fonctionnera plus.")) makeInvite.mutate(); }} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary disabled:opacity-60"><RefreshCw className="h-3.5 w-3.5" /> Nouveau lien</button>
                      <button disabled={stopInvite.isPending} onClick={() => stopInvite.mutate()} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-secondary disabled:opacity-60">Désactiver</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-muted-foreground">Toute personne qui a le lien peut rejoindre le groupe (50 membres maximum).</p>
                    <button disabled={makeInvite.isPending} onClick={() => makeInvite.mutate()} className="brand-gradient mt-2 flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60">
                      {makeInvite.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Créer un lien
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="space-y-0.5">
              {detail.members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-2xl p-2.5">
                  <Link to="/u/$username" params={{ username: m.username }} onClick={onClose} className="flex min-w-0 flex-1 items-center gap-3">
                    <MiniAvatar url={m.avatar_url} name={m.display_name} size={44} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 text-sm font-semibold text-foreground"><span className="truncate">{m.id === myId ? "Toi" : m.display_name}</span><BadgeList badges={m.badges} size={14} /></span>
                      <span className="block truncate text-xs text-muted-foreground">@{m.username}</span>
                    </span>
                  </Link>
                  {m.isAdmin && <span className="shrink-0 rounded-full border border-primary/40 px-2 py-0.5 text-[10px] font-semibold text-primary">Admin</span>}
                  {detail.myIsAdmin && m.id !== myId && (
                    <button
                      aria-label={`Retirer ${m.display_name}`}
                      disabled={remove.isPending}
                      onClick={() => { if (window.confirm(`Retirer ${m.display_name} du groupe ?`)) remove.mutate(m.id); }}
                      className="shrink-0 rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-50"
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              disabled={leave.isPending}
              onClick={() => { if (window.confirm("Quitter ce groupe ?")) leave.mutate(); }}
              className="mt-4 flex w-full items-center gap-3 rounded-2xl p-2.5 text-left text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10"><LogOut className="h-5 w-5" /></span>
              <span className="text-sm font-bold">Quitter le groupe</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
