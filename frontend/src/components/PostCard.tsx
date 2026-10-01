import { Heart, MessageCircle, Repeat2, Bookmark, MoreHorizontal, Trash2, Pencil, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BadgeList } from "@/components/KalBadge";
import { useAuth } from "@/lib/auth";
import {
  addComment,
  deleteComment,
  deletePost,
  fetchComments,
  repost,
  timeAgo,
  toggleLike,
  toggleSave,
  updatePost,
  type FeedPost,
} from "@/lib/social";

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

export function PostCard({ post }: { post: FeedPost }) {
  const { user, isStaff } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showComments, setShowComments] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.content);
  const [commentText, setCommentText] = useState("");

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
    mutationFn: () => addComment(post.id, commentText.trim()),
    onSuccess: () => {
      setCommentText("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <article className="border-b border-border px-4 py-4">
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
            post.content && <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-foreground">{post.content}</p>
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

          <div className="mt-3 flex items-center justify-between text-muted-foreground">
            <button
              onClick={() => requireAuth() && likeMutation.mutate()}
              className={`flex items-center gap-1.5 text-xs transition-colors ${post.likedByMe ? "text-like" : "hover:text-like"}`}
            >
              <Heart className="h-[18px] w-[18px]" fill={post.likedByMe ? "currentColor" : "none"} />
              {post.likeCount}
            </button>
            <button
              onClick={() => setShowComments((v) => !v)}
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
              {commentsQuery.data?.map((c) => (
                <div key={c.id} className="flex items-start gap-2">
                  {c.author ? (
                    <Link to="/u/$username" params={{ username: c.author.username }} aria-label={`Profil de ${c.author.display_name}`}>
                      <Avatar url={c.author.avatar_url} name={c.author.display_name} size={28} />
                    </Link>
                  ) : (
                    <Avatar url={null} name="?" size={28} />
                  )}
                  <div className="min-w-0 flex-1 rounded-2xl bg-secondary/50 px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {c.author ? (
                        <Link to="/u/$username" params={{ username: c.author.username }} className="truncate text-xs font-semibold text-foreground hover:underline">{c.author.display_name}</Link>
                      ) : (
                        <span className="truncate text-xs font-semibold text-foreground">Compte supprimé</span>
                      )}
                      {c.author && <BadgeList badges={c.author.badges ?? []} size={12} />}
                      <span className="text-[10px] text-muted-foreground">{timeAgo(c.created_at)}</span>
                    </div>
                    <p className="whitespace-pre-line text-xs text-foreground">{c.content}</p>
                  </div>
                  {(user?.id === c.author_id || isMine || isStaff) && (
                    <button
                      aria-label="Supprimer le commentaire"
                      onClick={() => deleteCommentMutation.mutate(c.id)}
                      className="p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}

              {user ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (commentText.trim()) commentMutation.mutate();
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Écrire un commentaire…"
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
