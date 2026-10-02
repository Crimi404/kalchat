import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCheck, ImagePlus, Loader2, MoreVertical, Send, Star, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useOnline } from "@/lib/presence";
import { BadgeList } from "@/components/KalBadge";
import { GroupInfoSheet } from "@/components/GroupInfoSheet";
import { MiniAvatar } from "@/components/MiniAvatar";
import { MAX_UPLOAD_MB, uploadMedia } from "@/lib/media";
import { deleteMessage, fetchConversationDetail, fetchMessages, joinConversation, markRead, sendMessage, toggleFavoriteConversation } from "@/lib/chat";

export const Route = createFileRoute("/_authenticated/messages/$id")({
  head: () => ({
    meta: [
      { title: "Conversation — Kalchat" },
      { name: "description", content: "Conversation privée sur Kalchat." },
      { property: "og:title", content: "Conversation — Kalchat" },
      { property: "og:description", content: "Conversation privée sur Kalchat." },
    ],
  }),
  component: ChatPage,
});

function ChatPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const uid = user!.id;
  const qc = useQueryClient();
  const online = useOnline();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const conv = useQuery({ queryKey: ["conversation", id], queryFn: () => fetchConversationDetail(id, uid) });
  const msgs = useQuery({ queryKey: ["messages", id], queryFn: () => fetchMessages(id) });
  const detail = conv.data;
  const other = detail?.other ?? null;
  const isGroup = !!detail?.isGroup;

  const favorite = useMutation({
    mutationFn: () => toggleFavoriteConversation(id),
    onSuccess: (r) => {
      toast.success(r.favorite ? "Ajouté aux favoris" : "Retiré des favoris");
      void qc.invalidateQueries({ queryKey: ["conversation", id] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Rejoint la conversation en direct (Socket.io) tant que la page est ouverte
  useEffect(() => joinConversation(id), [id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    if (msgs.data?.some((m) => m.sender_id !== uid && !m.seen)) {
      void markRead(id).then(() => {
        void qc.invalidateQueries({ queryKey: ["unread"] });
        void qc.invalidateQueries({ queryKey: ["conversations"] });
      });
    }
  }, [msgs.data, id, uid, qc]);

  const [sendingFile, setSendingFile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function sendFile(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) { toast.error("Choisis une photo ou une vidéo"); return; }
    if (f.size > MAX_UPLOAD_MB * 1024 * 1024) { toast.error(`Fichier trop lourd (${MAX_UPLOAD_MB} Mo max)`); return; }
    setSendingFile(true);
    try {
      const media = await uploadMedia(f);
      await sendMessage(id, text, media);
      setText("");
      await qc.invalidateQueries({ queryKey: ["messages", id] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSendingFile(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const send = useMutation({
    mutationFn: (body: string) => sendMessage(id, body),
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: ["messages", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: deleteMessage,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages", id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (conv.isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!detail || (!isGroup && !other)) return <p className="py-20 text-center text-sm text-muted-foreground">Conversation introuvable.</p>;

  return (
    <div className="app-shell flex h-[100dvh] flex-col">
      <header className="relative flex items-center gap-3 border-b border-border bg-background/90 px-3 py-2.5 backdrop-blur-xl">
        <Link to="/messages" aria-label="Retour" className="p-1.5"><ArrowLeft className="h-5 w-5" /></Link>
        {isGroup ? (
          <button onClick={() => setInfoOpen(true)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
            <MiniAvatar url={detail.avatar_url} name={detail.name} size={36} group />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-foreground">{detail.name}</span>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Users className="h-3 w-3" />{detail.members.length} membres</span>
            </span>
          </button>
        ) : (
          <Link to="/u/$username" params={{ username: other!.username }} className="flex min-w-0 flex-1 items-center gap-2.5">
            <MiniAvatar url={other!.avatar_url} name={other!.display_name} size={36} />
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-sm font-bold text-foreground"><span className="truncate">{other!.display_name}</span><BadgeList badges={other!.badges} size={14} /></span>
              <span className="block text-[11px] text-muted-foreground">{online.has(other!.id) ? "En ligne" : `@${other!.username}`}</span>
            </span>
          </Link>
        )}
        <button aria-label="Options" onClick={() => setMenuOpen((v) => !v)} className="rounded-full p-2 hover:bg-secondary"><MoreVertical className="h-5 w-5" /></button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="animate-fade-in absolute right-3 top-full z-50 mt-1 w-56 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
              <button
                onClick={() => { setMenuOpen(false); favorite.mutate(); }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-foreground hover:bg-secondary"
              >
                <Star className={`h-4 w-4 ${detail.isFavorite ? "fill-current text-primary" : ""}`} />
                {detail.isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
              </button>
              {isGroup && (
                <button onClick={() => { setMenuOpen(false); setInfoOpen(true); }} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-foreground hover:bg-secondary">
                  <Users className="h-4 w-4" /> Infos du groupe
                </button>
              )}
            </div>
          </>
        )}
      </header>
      {infoOpen && isGroup && <GroupInfoSheet detail={detail} myId={uid} onClose={() => setInfoOpen(false)} />}

      <main className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        <p className="mx-auto mb-4 max-w-xs text-center text-[11px] text-muted-foreground">{isGroup ? "Messages du groupe : visibles uniquement par ses membres. Ils ne sont pas chiffrés de bout en bout." : "Messages privés : visibles uniquement par vous deux. Ils ne sont pas chiffrés de bout en bout."}</p>
        {msgs.data?.map((m) => {
          if (m.media_type === "system") {
            return (
              <p key={m.id} className="mx-auto my-2 w-fit max-w-[85%] rounded-full bg-secondary/70 px-3 py-1 text-center text-[11px] text-muted-foreground">{m.body}</p>
            );
          }
          const mine = m.sender_id === uid;
          return (
            <div key={m.id} className={`group flex items-center gap-1 ${mine ? "justify-end" : "justify-start"}`}>
              {mine && <button aria-label="Supprimer" onClick={() => del.mutate(m.id)} className="opacity-0 transition-opacity group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}
              <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${mine ? "brand-gradient rounded-br-md text-primary-foreground" : "rounded-bl-md bg-secondary text-foreground"}`}>
                {isGroup && !mine && <span className="mb-0.5 block text-[11px] font-semibold text-primary">{m.sender_name}</span>}
                {m.media_url && (m.media_type === "video" ? (
                  <video src={m.media_url} controls className="mb-1 max-h-64 rounded-xl" />
                ) : m.media_type === "audio" ? (
                  <audio src={m.media_url} controls className="mb-1 max-w-full" />
                ) : (
                  <img src={m.media_url} alt="" className="mb-1 max-h-64 rounded-xl object-cover" />
                ))}
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                <span className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {new Date(m.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  {mine && (m.seen ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />)}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </main>

      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(text); }} className="flex items-center gap-2 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => void sendFile(e.target.files?.[0])} />
        <button type="button" disabled={sendingFile} onClick={() => fileRef.current?.click()} aria-label="Envoyer une photo ou une vidéo" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-secondary disabled:opacity-60">
          {sendingFile ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
        </button>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Écris un message…" className="flex-1 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary" />
        <button disabled={send.isPending || !text.trim()} aria-label="Envoyer" className="brand-gradient flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground disabled:opacity-50"><Send className="h-4 w-4" /></button>
      </form>
    </div>
  );
}
