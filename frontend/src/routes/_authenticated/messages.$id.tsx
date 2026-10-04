import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCheck, ImagePlus, Loader2, Mic, Ban, Flag, MoreVertical, Pencil, Pin, Reply, Send, Star, Timer, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { dayKey, dayLabel } from "@/lib/dateLabel";
import { useOnline } from "@/lib/presence";
import { BadgeList } from "@/components/KalBadge";
import { GroupInfoSheet } from "@/components/GroupInfoSheet";
import { MiniAvatar } from "@/components/MiniAvatar";
import { EphemeralSheet } from "@/components/EphemeralSheet";
import { ReportSheet } from "@/components/ReportSheet";
import { blockUser, unblockUser } from "@/lib/settings";
import type { ReportTarget } from "@/lib/reports";
import { VoiceBubble } from "@/components/VoiceBubble";
import { SwipeableMessage } from "@/components/SwipeableMessage";
import { ActionIcons, MessageActionSheet, type MessageAction } from "@/components/MessageActionSheet";
import { ephemeralLabel } from "@/lib/settings";
import { MAX_VOICE_SECONDS, formatDuration, useVoiceRecorder } from "@/lib/voice";
import { MAX_UPLOAD_MB, uploadMedia } from "@/lib/media";
import { EDIT_WINDOW_MS, deleteMessage, editMessage, fetchConversationDetail, fetchMessages, joinConversation, markRead, messageSnippet, sendMessage, setEphemeral, togglePinMessage, toggleFavoriteConversation, type MessageRow } from "@/lib/chat";

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
  const [ephOpen, setEphOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [editing, setEditing] = useState<MessageRow | null>(null);
  const [actionMsg, setActionMsg] = useState<MessageRow | null>(null);
  const [reporting, setReporting] = useState<{ type: ReportTarget; id: string } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [pinIdx, setPinIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastMsgRef = useRef<string | null>(null);

  const conv = useQuery({ queryKey: ["conversation", id], queryFn: () => fetchConversationDetail(id, uid) });
  const detail = conv.data;
  const ephemeralSeconds = detail?.ephemeralSeconds ?? 0;
  // Avec les messages éphémères, on revérifie régulièrement pour faire disparaître ceux qui ont expiré
  const msgs = useQuery({ queryKey: ["messages", id], queryFn: () => fetchMessages(id), refetchInterval: ephemeralSeconds > 0 ? 30000 : false });
  const other = detail?.other ?? null;
  const isGroup = !!detail?.isGroup;

  const ephemeral = useMutation({
    mutationFn: (seconds: number) => setEphemeral(id, seconds),
    onSuccess: () => {
      setEphOpen(false);
      void qc.invalidateQueries({ queryKey: ["conversation", id] });
      void qc.invalidateQueries({ queryKey: ["messages", id] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const block = useMutation({
    mutationFn: (unblock: boolean) => (unblock ? unblockUser(other!.username) : blockUser(other!.username)),
    onSuccess: (_d, unblock) => {
      toast.success(unblock ? "Compte débloqué" : `@${other!.username} est bloqué`);
      void qc.invalidateQueries({ queryKey: ["conversation", id] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
    const lastId = msgs.data?.length ? msgs.data[msgs.data.length - 1].id : null;
    if (lastId !== lastMsgRef.current) {
      lastMsgRef.current = lastId;
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
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
      await sendMessage(id, text, media, replyTo?.id);
      setText("");
      setReplyTo(null);
      await qc.invalidateQueries({ queryKey: ["messages", id] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSendingFile(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // ---------- Messages vocaux (2 minutes maximum) ----------
  const voice = useVoiceRecorder(async (file, duration) => {
    setSendingFile(true);
    try {
      const media = await uploadMedia(file);
      await sendMessage(id, "", { url: media.url, type: "audio", duration }, replyTo?.id);
      setReplyTo(null);
      await qc.invalidateQueries({ queryKey: ["messages", id] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      if (duration >= MAX_VOICE_SECONDS) toast.info("Durée maximale atteinte : message vocal envoyé");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSendingFile(false);
    }
  });

  async function startVoice() {
    try {
      await voice.start();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const send = useMutation({
    mutationFn: (body: string) => sendMessage(id, body, undefined, replyTo?.id),
    onSuccess: () => { setText(""); setReplyTo(null); void qc.invalidateQueries({ queryKey: ["messages", id] }); void qc.invalidateQueries({ queryKey: ["conversations"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: deleteMessage,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["messages", id] }); void qc.invalidateQueries({ queryKey: ["conversation", id] }); void qc.invalidateQueries({ queryKey: ["conversations"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const edit = useMutation({
    mutationFn: ({ messageId, content }: { messageId: string; content: string }) => editMessage(messageId, content),
    onSuccess: () => { setEditing(null); setText(""); void qc.invalidateQueries({ queryKey: ["messages", id] }); void qc.invalidateQueries({ queryKey: ["conversations"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const pin = useMutation({
    mutationFn: (messageId: string) => togglePinMessage(messageId),
    onSuccess: (r) => {
      toast.success(r.pinned ? "Message épinglé" : "Message désépinglé");
      void qc.invalidateQueries({ queryKey: ["messages", id] });
      void qc.invalidateQueries({ queryKey: ["conversation", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startReply(m: MessageRow) {
    setEditing(null);
    setReplyTo(m);
    inputRef.current?.focus();
  }
  function startEdit(m: MessageRow) {
    setReplyTo(null);
    setEditing(m);
    setText(m.body);
    inputRef.current?.focus();
  }
  function cancelCompose() {
    setReplyTo(null);
    if (editing) setText("");
    setEditing(null);
  }
  function submitText() {
    const t = text.trim();
    if (!t) return;
    if (editing) edit.mutate({ messageId: editing.id, content: t });
    else send.mutate(t);
  }
  /** Fait défiler jusqu'à un message (réponse citée, message épinglé) et le met brièvement en évidence. */
  function jumpTo(messageId: string) {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) { toast.info("Ce message est trop ancien pour être affiché ici"); return; }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(messageId);
    window.setTimeout(() => setHighlightId((cur) => (cur === messageId ? null : cur)), 1400);
  }
  function actionsFor(m: MessageRow): MessageAction[] {
    const mine = m.sender_id === uid;
    const list: MessageAction[] = [{ id: "reply", label: "Répondre", icon: ActionIcons.reply, onSelect: () => startReply(m) }];
    if (m.body) {
      list.push({
        id: "copy",
        label: "Copier le texte",
        icon: ActionIcons.copy,
        onSelect: () => { void navigator.clipboard?.writeText(m.body).then(() => toast.success("Texte copié")).catch(() => toast.error("Copie impossible")); },
      });
    }
    list.push({ id: "pin", label: m.pinned ? "Désépingler" : "Épingler", icon: m.pinned ? ActionIcons.unpin : ActionIcons.pin, onSelect: () => pin.mutate(m.id) });
    const editable = mine && m.media_type !== "audio" && !m.media_type?.endsWith("_expired") && Date.now() - new Date(m.created_at).getTime() <= EDIT_WINDOW_MS;
    if (editable) list.push({ id: "edit", label: "Modifier", icon: ActionIcons.edit, onSelect: () => startEdit(m) });
    if (!mine) {
      list.push({ id: "report", label: "Signaler le message", icon: ActionIcons.report, danger: true, onSelect: () => setReporting({ type: "message", id: m.id }) });
    }
    if (mine) {
      list.push({
        id: "delete",
        label: "Supprimer pour tout le monde",
        icon: ActionIcons.delete,
        danger: true,
        onSelect: () => { if (window.confirm("Supprimer ce message pour tout le monde ?")) del.mutate(m.id); },
      });
    }
    return list;
  }

  if (conv.isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!detail || (!isGroup && !other)) return <p className="py-20 text-center text-sm text-muted-foreground">Conversation introuvable.</p>;

  return (
    <div className="app-shell flex h-[100dvh] flex-col">
      <header className="relative z-30 flex items-center gap-3 border-b border-border bg-background/90 px-3 py-2.5 backdrop-blur-xl">
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
              {(!isGroup || detail.myIsAdmin) && (
                <button onClick={() => { setMenuOpen(false); setEphOpen(true); }} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-foreground hover:bg-secondary">
                  <Timer className="h-4 w-4" /> Messages éphémères
                  <span className="ml-auto text-xs text-muted-foreground">{ephemeralLabel(ephemeralSeconds)}</span>
                </button>
              )}
              {isGroup && (
                <button onClick={() => { setMenuOpen(false); setInfoOpen(true); }} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-foreground hover:bg-secondary">
                  <Users className="h-4 w-4" /> Infos du groupe
                </button>
              )}
              {!isGroup && other && (
                <>
                  <button onClick={() => { setMenuOpen(false); setReporting({ type: "user", id: other.id }); }} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-foreground hover:bg-secondary">
                    <Flag className="h-4 w-4" /> Signaler @{other.username}
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      if (detail.blockedByMe) block.mutate(true);
                      else if (window.confirm(`Bloquer @${other.username} ? Cette personne ne pourra plus t'écrire ni te notifier, et vos abonnements seront supprimés.`)) block.mutate(false);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-destructive hover:bg-secondary"
                  >
                    <Ban className="h-4 w-4" /> {detail.blockedByMe ? `Débloquer @${other.username}` : `Bloquer @${other.username}`}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </header>
      {ephemeralSeconds > 0 && (
        <p className="flex items-center justify-center gap-1.5 border-b border-border bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary">
          <Timer className="h-3.5 w-3.5" /> Messages éphémères : les nouveaux messages disparaissent après {ephemeralLabel(ephemeralSeconds)}
        </p>
      )}
      {detail.pinned.length > 0 && (() => {
        const idx = pinIdx % detail.pinned.length;
        const cur = detail.pinned[idx];
        return (
          <button onClick={() => { jumpTo(cur.id); setPinIdx((i) => i + 1); }} className="flex w-full items-center gap-2 border-b border-border bg-secondary/50 px-3 py-2 text-left">
            <Pin className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold text-primary">Message épinglé{detail.pinned.length > 1 ? ` · ${idx + 1}/${detail.pinned.length}` : ""}</span>
              <span className="block truncate text-xs text-foreground">{cur.senderName} : {cur.text}</span>
            </span>
          </button>
        );
      })()}
      {reporting && <ReportSheet type={reporting.type} targetId={reporting.id} onClose={() => setReporting(null)} />}
      {actionMsg && <MessageActionSheet preview={messageSnippet(actionMsg.body, actionMsg.media_type)} actions={actionsFor(actionMsg)} onClose={() => setActionMsg(null)} />}
      {ephOpen && <EphemeralSheet current={ephemeralSeconds} pending={ephemeral.isPending} onSelect={(s) => ephemeral.mutate(s)} onClose={() => setEphOpen(false)} />}
      {infoOpen && isGroup && <GroupInfoSheet detail={detail} myId={uid} onClose={() => setInfoOpen(false)} />}

      <main className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        <p className="mx-auto mb-4 max-w-xs text-center text-[11px] text-muted-foreground">{isGroup ? "Messages du groupe : visibles uniquement par ses membres. Ils ne sont pas chiffrés de bout en bout." : "Messages privés : visibles uniquement par vous deux. Ils ne sont pas chiffrés de bout en bout."}</p>
        {msgs.data?.map((m, i) => {
          const prev = i > 0 ? msgs.data![i - 1] : null;
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const row = (() => {
          if (m.media_type === "system") {
            return (
              <p key={m.id} className="mx-auto my-2 w-fit max-w-[85%] rounded-full bg-secondary/70 px-3 py-1 text-center text-[11px] text-muted-foreground">{m.body}</p>
            );
          }
          const mine = m.sender_id === uid;
          return (
            <div key={m.id} id={`msg-${m.id}`} className={`rounded-2xl transition-colors duration-500 ${highlightId === m.id ? "bg-primary/20" : ""}`}>
              <SwipeableMessage onReply={() => startReply(m)} onLongPress={() => setActionMsg(m)}>
                <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${mine ? "brand-gradient rounded-br-md text-primary-foreground" : "rounded-bl-md bg-secondary text-foreground"}`}>
                    {isGroup && !mine && <span className="mb-0.5 block text-[11px] font-semibold text-primary">{m.sender_name}</span>}
                    {m.reply && (
                      <button
                        type="button"
                        onClick={() => m.reply && !m.reply.deleted && jumpTo(m.reply.id)}
                        className={`mb-1.5 block w-full rounded-lg border-l-4 px-2 py-1 text-left text-xs ${mine ? "border-primary-foreground/70 bg-primary-foreground/15" : "border-primary bg-background/50"}`}
                      >
                        <span className="block font-semibold">{m.reply.senderId === uid ? "Toi" : m.reply.senderName}</span>
                        <span className={`block truncate ${m.reply.deleted ? "italic opacity-70" : "opacity-90"}`}>{m.reply.text}</span>
                      </button>
                    )}
                    {m.media_type === "audio_expired" && <p className="mb-1 text-xs italic opacity-80">🎤 Message vocal expiré (supprimé après 60 jours)</p>}
                    {m.media_type === "video_expired" && <p className="mb-1 text-xs italic opacity-80">🎥 Vidéo indisponible (supprimée après 60 jours)</p>}
                    {m.media_url && (m.media_type === "video" ? (
                      <video src={m.media_url} controls className="mb-1 max-h-64 rounded-xl" />
                    ) : m.media_type === "audio" ? (
                      <VoiceBubble src={m.media_url} duration={m.duration} mine={mine} />
                    ) : (
                      <img src={m.media_url} alt="" draggable={false} className="mb-1 max-h-64 rounded-xl object-cover" />
                    ))}
                    {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                    <span className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {m.pinned && <Pin className="h-3 w-3" />}
                      {m.edited && <span className="italic">modifié</span>}
                      {new Date(m.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      {mine && (m.seen ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />)}
                    </span>
                  </div>
                </div>
              </SwipeableMessage>
            </div>
          );
          })();
          return (
            <Fragment key={m.id}>
              {newDay && <p className="mx-auto my-3 w-fit rounded-full bg-secondary/80 px-3 py-1 text-center text-[11px] font-semibold text-muted-foreground">{dayLabel(m.created_at)}</p>}
              {row}
            </Fragment>
          );
        })}
        <div ref={endRef} />
      </main>

      {!isGroup && (detail.blockedByMe || detail.blockedMe) ? (
        <div className="border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
          {detail.blockedByMe ? (
            <>
              <p className="text-xs text-muted-foreground">Tu as bloqué @{other!.username}. Vous ne pouvez plus vous écrire.</p>
              <button disabled={block.isPending} onClick={() => block.mutate(true)} className="mt-2 rounded-full border border-border bg-card px-5 py-2 text-sm font-bold text-foreground hover:bg-secondary disabled:opacity-60">
                Débloquer
              </button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Tu ne peux plus envoyer de message à ce compte.</p>
          )}
        </div>
      ) : voice.recording ? (
        <div className="flex items-center gap-2 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={voice.cancel} aria-label="Annuler l'enregistrement" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-destructive hover:bg-secondary">
            <Trash2 className="h-5 w-5" />
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-foreground">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" />
            <span className="font-semibold tabular-nums">{formatDuration(voice.seconds)}</span>
            <span className="text-xs text-muted-foreground">/ {formatDuration(MAX_VOICE_SECONDS)}</span>
            <span className="ml-auto text-xs text-muted-foreground">Enregistrement…</span>
          </div>
          <button type="button" onClick={voice.stop} aria-label="Envoyer le message vocal" className="brand-gradient flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground">
            <Send className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="border-t border-border">
        {(replyTo || editing) && (
          <div className="flex items-center gap-2 border-b border-border bg-secondary/40 px-3 py-2">
            {editing ? <Pencil className="h-4 w-4 shrink-0 text-primary" /> : <Reply className="h-4 w-4 shrink-0 text-primary" />}
            <span className="min-w-0 flex-1 border-l-4 border-primary pl-2">
              <span className="block text-[11px] font-semibold text-primary">
                {editing ? "Modifier le message" : `Répondre à ${replyTo!.sender_id === uid ? "toi-même" : replyTo!.sender_name}`}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{messageSnippet((editing ?? replyTo)!.body, (editing ?? replyTo)!.media_type)}</span>
            </span>
            <button type="button" aria-label="Annuler" onClick={cancelCompose} className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); submitText(); }} className="flex items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => void sendFile(e.target.files?.[0])} />
          <button type="button" disabled={sendingFile} onClick={() => fileRef.current?.click()} aria-label="Envoyer une photo ou une vidéo" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-secondary disabled:opacity-60">
            {sendingFile ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
          </button>
          <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={editing ? "Modifie ton message…" : "Écris un message…"} className="flex-1 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary" />
          {text.trim() ? (
            <button disabled={send.isPending || edit.isPending} aria-label={editing ? "Enregistrer la modification" : "Envoyer"} className="brand-gradient flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground disabled:opacity-50"><Send className="h-4 w-4" /></button>
          ) : (
            <button type="button" disabled={sendingFile} onClick={() => void startVoice()} aria-label="Enregistrer un message vocal" className="brand-gradient flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground disabled:opacity-50"><Mic className="h-5 w-5" /></button>
          )}
        </form>
        </div>
      )}
    </div>
  );
}
