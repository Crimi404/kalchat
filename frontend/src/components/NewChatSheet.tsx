import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "@tanstack/react-router";
import { ArrowLeft, Camera, ChevronRight, Loader2, MessageSquarePlus, UserPlus, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ContactPicker } from "@/components/ContactPicker";
import { MiniAvatar } from "@/components/MiniAvatar";
import { createGroup, fetchContacts, getOrCreateConversation } from "@/lib/chat";
import { uploadMedia } from "@/lib/media";
import type { MiniProfile } from "@/lib/social";
import { useBackHandler } from "@/lib/back";

type Step = "menu" | "chat" | "members" | "name";

const MAX_GROUP_MEMBERS = 50;

/** Feuille du bouton « + » de la messagerie : nouvelle discussion, nouveau groupe, trouver des membres. */
export function NewChatSheet({ onClose }: { onClose: () => void }) {
  useBackHandler(onClose);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("menu");
  const [selected, setSelected] = useState<MiniProfile[]>([]);
  const [groupName, setGroupName] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  const contactsQ = useQuery({ queryKey: ["contacts"], queryFn: fetchContacts });

  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);

  const openChat = useMutation({
    mutationFn: (c: MiniProfile) => getOrCreateConversation(c.id),
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      onClose();
      void navigate({ to: "/messages/$id", params: { id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: async () => {
      const avatarUrl = photo ? (await uploadMedia(photo, { maxSide: 640 })).url : null;
      return createGroup({ name: groupName.trim(), memberIds: selected.map((s) => s.id), avatarUrl });
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      toast.success("Groupe créé");
      onClose();
      void navigate({ to: "/messages/$id", params: { id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggle(c: MiniProfile) {
    setSelected((prev) => {
      if (prev.some((p) => p.id === c.id)) return prev.filter((p) => p.id !== c.id);
      if (prev.length + 1 >= MAX_GROUP_MEMBERS) { toast.error(`${MAX_GROUP_MEMBERS} membres maximum`); return prev; }
      return [...prev, c];
    });
  }

  function back() {
    if (step === "name") setStep("members");
    else if (step === "members") setStep("menu");
    else if (step === "chat") setStep("menu");
    else onClose();
  }

  const title = step === "menu" ? "Nouveau" : step === "chat" ? "Nouvelle discussion" : step === "members" ? "Nouveau groupe" : "Infos du groupe";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="animate-fade-in flex max-h-[85vh] min-h-[40vh] w-full max-w-md flex-col rounded-t-3xl border border-border bg-card sm:rounded-3xl" style={step === "menu" ? undefined : { height: "80vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-3">
          <button aria-label={step === "menu" ? "Fermer" : "Retour"} onClick={back} className="rounded-full p-2 hover:bg-secondary">
            {step === "menu" ? <X className="h-5 w-5" /> : <ArrowLeft className="h-5 w-5" />}
          </button>
          <h3 className="flex-1 font-bold text-foreground">{title}</h3>
          {step === "members" && <span className="pr-2 text-xs text-muted-foreground">{selected.length} sélectionné{selected.length > 1 ? "s" : ""}</span>}
        </div>

        {step === "menu" && (
          <div className="space-y-1 px-3 pb-5">
            {[
              { icon: Users, label: "Nouveau groupe", hint: "Discute à plusieurs avec tes amis", onClick: () => { setSelected([]); setStep("members"); } },
              { icon: MessageSquarePlus, label: "Nouvelle discussion", hint: "Écris à un ami", onClick: () => setStep("chat") },
            ].map(({ icon: Icon, label, hint, onClick }) => (
              <button key={label} onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-secondary">
                <span className="brand-gradient flex h-11 w-11 items-center justify-center rounded-full text-primary-foreground"><Icon className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-foreground">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
            <Link to="/explorer" onClick={onClose} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-secondary">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-secondary text-foreground"><UserPlus className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-foreground">Trouver des membres</span>
                <span className="block text-xs text-muted-foreground">Ouvre un profil pour leur écrire</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </div>
        )}

        {step === "chat" && (
          <ContactPicker contacts={contactsQ.data} loading={contactsQ.isLoading} onPick={(c) => !openChat.isPending && openChat.mutate(c)} onNavigate={onClose} />
        )}

        {step === "members" && (
          <>
            {selected.length > 0 && (
              <div className="flex gap-3 overflow-x-auto px-4 pb-3">
                {selected.map((s) => (
                  <button key={s.id} onClick={() => toggle(s)} className="relative flex w-14 shrink-0 flex-col items-center gap-1" aria-label={`Retirer ${s.display_name}`}>
                    <MiniAvatar url={s.avatar_url} name={s.display_name} size={44} />
                    <span className="absolute right-1 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-muted-foreground text-background"><X className="h-3 w-3" /></span>
                    <span className="w-full truncate text-center text-[10px] text-muted-foreground">{s.display_name}</span>
                  </button>
                ))}
              </div>
            )}
            <ContactPicker contacts={contactsQ.data} loading={contactsQ.isLoading} multi selectedIds={selectedIds} onToggle={toggle} onNavigate={onClose} />
            <div className="border-t border-border p-3">
              <button disabled={selected.length < 1} onClick={() => setStep("name")} className="brand-gradient w-full rounded-xl py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {selected.length < 1 ? "Choisis au moins un ami" : "Suivant"}
              </button>
            </div>
          </>
        )}

        {step === "name" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-5 overflow-y-auto px-4 pt-2">
              <div className="flex items-center gap-4">
                <label className="relative cursor-pointer">
                  {photoUrl ? (
                    <img src={photoUrl} alt="Photo du groupe" className="h-20 w-20 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-border bg-secondary text-muted-foreground"><Camera className="h-7 w-7" /></span>
                  )}
                  <input type="file" accept="image/*" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                </label>
                <div className="min-w-0 flex-1">
                  <input
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    maxLength={50}
                    placeholder="Nom du groupe"
                    autoFocus
                    className="w-full rounded-xl border border-border bg-secondary/60 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
                  />
                  <p className="mt-1 text-right text-[11px] text-muted-foreground">{groupName.length}/50</p>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-muted-foreground">Membres : {selected.length + 1} (toi inclus)</p>
                <div className="flex flex-wrap gap-2">
                  {selected.map((s) => (
                    <span key={s.id} className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-1 pl-1 pr-3 text-xs text-foreground">
                      <MiniAvatar url={s.avatar_url} name={s.display_name} size={22} />{s.display_name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="border-t border-border p-3">
              <button disabled={!groupName.trim() || create.isPending} onClick={() => create.mutate()} className="brand-gradient flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Créer le groupe
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
