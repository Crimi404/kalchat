import { Heart, MessageCircle, Repeat2, Bookmark, MoreHorizontal, Trash2, Pencil, Loader2, Send, X } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RichText } from "@/components/RichText";
import { BadgeList } from "@/components/KalBadge";
import { useAuth } from "@/lib/auth";
import {
  addComment,
  deleteComment,
  deletePost,
  fetchComments,
  repost,
  timeAgo,
  toggleCommentLike,
  toggleLike,
  toggleSave,
  updateComment,
  updatePost,
  type CommentRow,
  type FeedPost,
} from "@/lib/social";

// Au-delà de cette limite, le texte est coupé avec « Voir plus » (la page de la publication affiche tout)
const PREVIEW_CHARS = 280;
const PREVIEW_LINES = 6;

function previewOf(content: string): { text: string; truncated: boolean } {
  const lines = content.split("\n");
  let text = lines.length > PREVIEW_LINES ? lines.slice(0, PREVIEW_LINES).join("\n") : content;
  let truncated = lines.length > PREVIEW_LINES;
  if (text.length > PREVIEW_CHARS) {
    const cut = text.slice(0, PREVIEW_CHARS);
    const lastSpace = cut.lastIndexOf(" ");
    text = lastSpace > PREVIEW_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut;
    truncated = true;
  }
  return { text: text.trimEnd(), truncated };
}

function Avatar({ url, name, size = 44 }: { url: string | null | undefined; name: string; size?: number }) {
  return url ? (
    <img src={url} alt={name} loading="lazy" className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="brand-gradient flex items-center justify-center rounded-full font-bold text-primary-foreground"
      style={{ width: size, height: size, fontSize: size / 2.6 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Un commentaire (ou une réponse) : j'aime, répondre, modifier, supprimer. */
function CommentItem({
  c, isReply, canDelete, isMine, onReply, onLike, onDelete, onSave, saving,
}: {
  c: CommentRow;
  isReply: boolean;
  canDelete: boolean;
  isMine: boolean;
  onReply: () => void;
  onLike: () => void;
  onDelete: () => void;
  onSave: (text: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.content);

  return (
    <div className="flex items-start gap-2">
      {c.author ? (
        <Link to="/u/$username" params={{ username: c.author.username }} aria-label={`Profil de ${c.author.display_name}`}>
          <Avatar url={c.author.avatar_url} name={c.author.display_name} size={isReply ? 24 : 28} />
        </Link>
      ) : (
        <Avatar url={null} name="?" size={isReply ? 24 : 28} />
      )}
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-secondary/50 px-3 py-2">
          <div className="flex items-center gap-1.5">
            {c.author ? (
              <Link to="/u/$username" params={{ username: c.author.username }} className="truncate text-xs font-semibold text-foreground hover:underline">{c.author.display_name}</Link>
            ) : (
              <span className="truncate text-xs font-semibold text-foreground">Compte supprimé</span>
            )}
            {c.author && <BadgeList badges={c.author.badges ?? []} size={12} />}
            <span className="text-[10px] text-muted-foreground">{timeAgo(c.created_at)}{c.edited_at ? " · modifié" : ""}</span>
          </div>
          {editing ? (
            <div className="mt-1">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-border bg-background/60 p-2 text-xs text-foreground outline-none focus:border-primary"
              />
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => { onSave(draft.trim()); setEditing(false); }}
                  disabled={saving || !draft.trim()}
                  className="brand-gradient rounded-full px-3 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-60"
                >
                  Enregistrer
                </button>
                <button
                  onClick={() => { setDraft(c.content); setEditing(false); }}
                  className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-muted-foreground"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-line break-words text-xs text-foreground"><RichText text={c.content} /></p>
          )}
        </div>
        <div className="mt-1 flex items-center gap-4 px-2 text-[11px] text-muted-foreground">
          <button onClick={onLike} className={`flex items-center gap-1 transition-colors ${c.likedByMe ? "text-like" : "hover:text-like"}`}>
            <Heart className="h-3.5 w-3.5" fill={c.likedByMe ? "currentColor" : "none"} />
            {c.likeCount > 0 ? c.likeCount : "J'aime"}
          </button>
          <button onClick={onReply} className="font-semibold hover:text-primary">Répondre</button>
          {isMine && !editing && (
            <button onClick={() => setEditing(true)} aria-label="Modifier le commentaire" className="hover:text-primary"><Pencil className="h-3 w-3" /></button>
          )}
          {canDelete && (
            <button onClick={onDelete} aria-label="Supprimer le commentaire" className="hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * `detail` = page d'une publication : texte en entier, commentaires affichés en bas.
 * Dans le fil, un appui sur la publication (hors boutons, liens et vidéo) l'ouvre.
 */
export function PostCard({ post, detail = false }: { post: FeedPost; detail?: boolean }) {
  const { user, isStaff } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showComments = detail;
  const commentInputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.content);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const isMine = user?.id === post.author_id;
  const author = post.author;
  const name = author?.display_name ?? "Compte supprimé";

  const invalidate = () => queryClient.invalidateQueries();

  function requireAuth() {
    if (user) return true;
    toast.info("Connecte-toi pour interagir");
    navigate({ to: "/auth" });
    return false;
  }

  const likeMutation = useMutation({
    mutationFn: () => toggleLike(post.id),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const saveMutation = useMutation({
    mutationFn: () => toggleSave(post.id),
    onSuccess: () => {
      invalidate();
      toast.success(post.savedByMe ? "Retiré des enregistrements" : "Publication enregistrée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const repostMutation = useMutation({
    mutationFn: () => repost(post.id),
    onSuccess: () => {
      invalidate();
      toast.success("Repartagé sur ton profil");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePost(post.id),
    onSuccess: () => {
      invalidate();
      toast.success("Publication supprimée");
      if (detail) {
        if (window.history.length > 1) window.history.back();
        else navigate({ to: "/" });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editMutation = useMutation({
    mutationFn: () => updatePost(post.id, draft.trim()),
    onSuccess: () => {
      setEditing(false);
      invalidate();
      toast.success("Publication modifiée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const commentsQuery = useQuery({
    queryKey: ["comments", post.id],
    queryFn: () => fetchComments(post.id),
    enabled: showComments,
  });

  const commentMutation = useMutation({
    mutationFn: () => addComment(post.id, commentText.trim(), replyTo?.id ?? null),
    onSuccess: (created) => {
      setCommentText("");
      if (created.parentId) setExpanded((prev) => new Set(prev).add(created.parentId!));
      setReplyTo(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const likeCommentMutation = useMutation({
    mutationFn: (id: string) => toggleCommentLike(id),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const editCommentMutation = useMutation({
    mutationFn: (v: { id: string; text: string }) => updateComment(v.id, v.text),
    onSuccess: () => {
      invalidate();
      toast.success("Commentaire modifié");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startReply(c: CommentRow) {
    if (!requireAuth()) return;
    const username = c.author?.username;
    // Les réponses sont toujours rattachées au commentaire racine ; on mentionne la personne à qui l'on répond
    setReplyTo({ id: c.id, username: username ?? "" });
    setCommentText(username ? `@${username} ` : "");
    commentInputRef.current?.focus();
  }

  const deleteCommentMutation = useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <article
      className={`border-b border-border px-4 py-4 ${detail ? "" : "cursor-pointer transition-colors hover:bg-secondary/20"}`}
      onClick={(e) => {
        if (detail || editing) return;
        const target = e.target as HTMLElement;
        if (target.closest("a, button, video, input, textarea, form")) return;
        if (window.getSelection()?.toString()) return; // l'utilisateur sélectionne du texte
        void navigate({ to: "/post/$id", params: { id: post.id } });
      }}
    >
      <div className="flex items-start gap-3">
        {author ? (
          <Link to="/u/$username" params={{ username: author.username }}>
            <Avatar url={author.avatar_url} name={name} />
          </Link>
        ) : (
          <Avatar url={null} name={name} />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-1.5">
              {author ? (
                <Link to="/u/$username" params={{ username: author.username }} className="truncate text-sm font-bold text-foreground hover:underline">
                  {name}
                </Link>
              ) : (
                <span className="truncate text-sm font-bold text-foreground">{name}</span>
              )}
              {author && <BadgeList badges={author.badges ?? []} size={15} />}
              <span className="truncate text-xs text-muted-foreground">
                {author ? `@${author.username}` : ""} · {timeAgo(post.created_at)}
              </span>
            </div>

            {(isMine || isStaff) && (
              <div className="relative">
                <button aria-label="Options" onClick={() => setMenuOpen((v) => !v)} className="rounded-full p-1 text-muted-foreground hover:bg-secondary">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuOpen && (
                  <>
                    <button aria-label="Fermer" className="fixed inset-0 z-40 cursor-default" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                      {isMine && (
                        <button
                          onClick={() => {
                            setMenuOpen(false);
                            setEditing(true);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-foreground hover:bg-secondary"
                        >
                          <Pencil className="h-4 w-4" /> Modifier
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          deleteMutation.mutate();
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-destructive hover:bg-secondary"
                      >
                        <Trash2 className="h-4 w-4" /> Supprimer
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {post.sharedFrom && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Repeat2 className="h-3.5 w-3.5" /> Repartagé depuis @{post.sharedFrom}
            </p>
          )}

          {editing ? (
            <div className="mt-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-border bg-secondary/40 p-3 text-sm text-foreground outline-none focus:border-primary"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => editMutation.mutate()}
                  disabled={editMutation.isPending || !draft.trim()}
                  className="brand-gradient rounded-full px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                >
                  Enregistrer
                </button>
                <button
                  onClick={() => {
                    setDraft(post.content);
                    setEditing(false);
                  }}
                  className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            post.content && (() => {
              const { text, truncated } = detail ? { text: post.content, truncated: false } : previewOf(post.content);
              return (
                <p className={`mt-1.5 whitespace-pre-line break-words leading-relaxed text-foreground ${detail ? "text-base" : "text-sm"}`}>
                  <RichText text={text} />
                  {truncated && (
                    <>
                      {"… "}
                      <Link to="/post/$id" params={{ id: post.id }} className="font-semibold text-primary hover:underline">Voir plus</Link>
                    </>
                  )}
                </p>
              );
            })()
          )}

          {post.image_url && (post.media_type === "video" ? (
            <video src={post.image_url} controls preload="metadata" className="mt-3 max-h-[28rem] w-full rounded-2xl border border-border bg-black" />
          ) : (
            <img
              src={post.image_url}
              alt="Publication"
              loading="lazy"
              className="mt-3 w-full rounded-2xl border border-border object-cover"
            />
          ))}

          {post.media_type === "video_expired" && (
            <div className="mt-3 rounded-2xl border border-dashed border-border bg-secondary/40 px-4 py-6 text-center text-xs text-muted-foreground">
              🎥 Vidéo indisponible (supprimée après 60 jours)
            </div>
          )}

          {detail && (
            <p className="mt-3 text-xs text-muted-foreground">
              {new Date(post.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · {new Date(post.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" })}
            </p>
          )}

          <div className={`mt-3 flex items-center justify-between text-muted-foreground ${detail ? "border-y border-border py-2.5" : ""}`}>
            <button
              onClick={() => requireAuth() && likeMutation.mutate()}
              className={`flex items-center gap-1.5 text-xs transition-colors ${post.likedByMe ? "text-like" : "hover:text-like"}`}
            >
              <Heart className="h-[18px] w-[18px]" fill={post.likedByMe ? "currentColor" : "none"} />
              {post.likeCount}
            </button>
            <button
              onClick={() => {
                if (detail) commentInputRef.current?.focus();
                else void navigate({ to: "/post/$id", params: { id: post.id } });
              }}
              className={`flex items-center gap-1.5 text-xs transition-colors ${showComments ? "text-primary" : "hover:text-primary"}`}
            >
              <MessageCircle className="h-[18px] w-[18px]" />
              {post.commentCount}
            </button>
            <button
              onClick={() => requireAuth() && repostMutation.mutate()}
              className="flex items-center gap-1.5 text-xs transition-colors hover:text-emerald-400"
            >
              <Repeat2 className="h-[18px] w-[18px]" />
              {post.shareCount > 0 ? post.shareCount : null}
            </button>
            <button
              onClick={() => requireAuth() && saveMutation.mutate()}
              aria-label="Enregistrer"
              className={`transition-colors ${post.savedByMe ? "text-primary" : "hover:text-primary"}`}
            >
              <Bookmark className="h-[18px] w-[18px]" fill={post.savedByMe ? "currentColor" : "none"} />
            </button>
          </div>

          {showComments && (
            <div className="mt-3 space-y-3 border-t border-border pt-3">
              {commentsQuery.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {commentsQuery.data?.length === 0 && <p className="text-xs text-muted-foreground">Aucun commentaire pour l'instant.</p>}
              {(() => {
                const all = commentsQuery.data ?? [];
                const roots = all.filter((c) => !c.parentId);
                const repliesOf = (id: string) => all.filter((c) => c.parentId === id);
                const renderItem = (c: CommentRow, isReply: boolean) => (
                  <CommentItem
                    key={c.id}
                    c={c}
                    isReply={isReply}
                    isMine={user?.id === c.author_id}
                    canDelete={user?.id === c.author_id || isMine || isStaff}
                    onReply={() => startReply(c)}
                    onLike={() => requireAuth() && likeCommentMutation.mutate(c.id)}
                    onDelete={() => deleteCommentMutation.mutate(c.id)}
                    onSave={(text) => editCommentMutation.mutate({ id: c.id, text })}
                    saving={editCommentMutation.isPending}
                  />
                );
                return roots.map((c) => {
                  const replies = repliesOf(c.id);
                  const open = expanded.has(c.id);
                  return (
                    <div key={c.id} className="space-y-2">
                      {renderItem(c, false)}
                      {replies.length > 0 && (
                        <div className="ml-9 space-y-2">
                          <button
                            onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                            className="text-[11px] font-semibold text-muted-foreground hover:text-primary"
                          >
                            {open ? "Masquer les réponses" : `Voir ${replies.length} réponse${replies.length > 1 ? "s" : ""}`}
                          </button>
                          {open && replies.map((r) => renderItem(r, true))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}

              {user && replyTo && (
                <div className="flex items-center justify-between rounded-xl bg-secondary/50 px-3 py-1.5 text-[11px] text-muted-foreground">
                  <span>Réponse à {replyTo.username ? `@${replyTo.username}` : "un commentaire"}</span>
                  <button aria-label="Annuler la réponse" onClick={() => { setReplyTo(null); setCommentText(""); }} className="p-0.5 hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                </div>
              )}
              {user ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (commentText.trim()) commentMutation.mutate();
                  }}
                  className={`flex items-center gap-2 ${detail ? "sticky bottom-[4.25rem] -mx-4 border-t border-border bg-background/95 px-4 py-2.5 backdrop-blur-xl" : ""}`}
                >
                  <input
                    ref={commentInputRef}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder={replyTo ? "Écris ta réponse…" : "Poste ta réponse…"}
                    className="flex-1 rounded-full border border-border bg-secondary/40 px-4 py-2 text-xs text-foreground outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    disabled={commentMutation.isPending || !commentText.trim()}
                    aria-label="Envoyer"
                    className="brand-gradient rounded-full p-2 text-primary-foreground disabled:opacity-60"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              ) : (
                <Link to="/auth" className="text-xs font-semibold text-primary">
                  Connecte-toi pour commenter
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export { Avatar };
