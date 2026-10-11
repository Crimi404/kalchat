import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Clapperboard, Heart, MessageCircle, Share2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, displayName, toBadges } from "@/lib/api";
import { BadgeList } from "@/components/KalBadge";
import { Avatar } from "@/components/PostCard";
import { ShortComments } from "@/components/ShortsFeed";
import { publicUrl, shareLink } from "@/lib/share";
import { VideoPlayer } from "@/components/VideoPlayer";
import { fetchShort, recordShortView, timeLeft, toggleShortLike, type ShortItem } from "@/lib/shorts";

/** Une vidéo K-Short publiée aussi dans le fil : c'est la même vidéo (mêmes j'aime et commentaires) que dans la section K-Short. */
export function ShortFeedCard({ short }: { short: ShortItem }) {
  const [src, setSrc] = useState(short.video_url);
  const [liked, setLiked] = useState(short.liked);
  const [likeCount, setLikeCount] = useState(short.like_count);
  const [commentCount, setCommentCount] = useState(short.comment_count);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const like = useMutation({
    mutationFn: () => toggleShortLike(short.id),
    onSuccess: (r) => {
      setLiked(r.liked);
      setLikeCount(r.like_count);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // L'adresse de lecture est temporaire : si elle expire pendant que le fil reste ouvert, on en demande une nouvelle
  function onVideoError() {
    fetchShort(short.id)
      .then((s) => (s.video_url ? setSrc(s.video_url) : setGone(true)))
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 404 || e.status === 410)) setGone(true);
      });
  }

  if (gone || !src || !short.author) return null;
  const author = short.author;
  const name = displayName({ username: author.username, first_name: author.first_name, last_name: author.last_name });

  return (
    <article className="border-b border-border px-4 py-3">
      <div className="flex items-center gap-3">
        <Link to="/u/$username" params={{ username: author.username }}>
          <Avatar url={author.avatar_url} name={name} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link to="/u/$username" params={{ username: author.username }} className="truncate text-sm font-bold text-foreground hover:underline">{name}</Link>
            <BadgeList badges={toBadges(author.id, author.badge, author.role)} />
          </div>
          <p className="text-xs text-muted-foreground">Disparaît dans {timeLeft(short.expires_at)}</p>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-[11px] font-semibold text-primary">
          <Clapperboard className="h-3.5 w-3.5" /> K-Short
        </span>
      </div>

      {short.caption && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{short.caption}</p>}

      {/* Pas de barre de contrôle dans le fil : un toucher = son / pause, double toucher à gauche ou à droite = −10 s / +10 s */}
      <VideoPlayer
        src={src}
        bare
        autoplayInView
        onVideoError={onVideoError}
        onPlayStart={(v) => {
          // Une lecture = un départ depuis le début (une reprise après pause ne compte pas) ; chaque nouveau visionnage compte, même par la même personne
          if (!short.mine && v.currentTime < 1.5) void recordShortView(short.id).catch(() => {});
        }}
        className="mt-2 max-h-[70vh] rounded-2xl"
        videoClassName="max-h-[70vh]"
      />

      <div className="mt-2 flex items-center gap-5 text-muted-foreground">
        <button onClick={() => like.mutate()} disabled={like.isPending} aria-label="J'aime" className="flex items-center gap-1.5 text-sm">
          <Heart className={`h-5 w-5 ${liked ? "fill-red-500 text-red-500" : ""}`} /> {likeCount}
        </button>
        <button onClick={() => setCommentsOpen(true)} aria-label="Commentaires" className="flex items-center gap-1.5 text-sm">
          <MessageCircle className="h-5 w-5" /> {commentCount}
        </button>
        <button
          onClick={() => void shareLink({ url: publicUrl(`/?k=${short.id}`), title: "K-Short sur Kalchat", text: short.caption ?? "Regarde cette vidéo sur Kalchat" })}
          aria-label="Partager"
          className="flex items-center gap-1.5 text-sm"
        >
          <Share2 className="h-5 w-5" />
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent<string>("kalchat:open-short", { detail: short.id }))}
          className="ml-auto text-xs font-semibold text-primary"
        >
          Ouvrir dans K-Short
        </button>
      </div>

      <ShortComments shortId={short.id} open={commentsOpen} isOwner={short.mine} onClose={() => setCommentsOpen(false)} onCountChange={setCommentCount} />
    </article>
  );
}
