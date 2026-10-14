import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Bookmark, Clock, Download, EllipsisVertical, EyeOff, Flag, Heart, Link2, Loader2, Maximize2, MessageCircle, Play, Plus, Repeat2, Send, Share2, Trash2, TriangleAlert, Volume2, VolumeX, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { ApiError, displayName, toBadges } from "@/lib/api";
import { BadgeList } from "@/components/KalBadge";
import { Avatar } from "@/components/PostCard";
import { ShortUploadSheet } from "@/components/ShortUploadSheet";
import { ReportSheet } from "@/components/ReportSheet";
import { ShortLikesSheet } from "@/components/ShortLikesSheet";
import { ShortSendSheet } from "@/components/ShortSendSheet";
import { SUPPORT_EMAIL } from "@/lib/legal";
import { toggleFollow, type Relationship } from "@/lib/social";
import { copyLink, publicUrl, shareLink } from "@/lib/share";
import { useBackHandler } from "@/lib/back";
import { setShortsAutoScroll, useShortsAutoScroll } from "@/lib/mediaPrefs";
import {
  addShortComment,
  deleteShort,
  deleteShortComment,
  downloadShort,
  fetchShort,
  fetchShortComments,
  fetchShortsFeed,
  hideShort,
  recordShortView,
  recordShortWatch,
  setShortDownload,
  timeLeft,
  toggleShortCommentLike,
  toggleShortLike,
  toggleShortRepost,
  toggleShortSave,
  unhideShort,
  type ShortComment,
  type ShortFollow,
  type ShortItem,
} from "@/lib/shorts";

type Patch = Partial<ShortItem> & { gone?: boolean };

// ---------- Un commentaire (aimer, répondre, supprimer) ----------
function CommentRow({
  c,
  reply,
  canDelete,
  deleting,
  onLike,
  onReply,
  onDelete,
  onClose,
}: {
  c: ShortComment;
  reply?: boolean;
  canDelete: boolean;
  deleting: boolean;
  onLike: (c: ShortComment) => void;
  onReply: (c: ShortComment) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className={`flex gap-2 py-2 ${reply ? "ml-9" : ""}`}>
      <Link to="/u/$username" params={{ username: c.username }} onClick={onClose}>
        <Avatar url={c.avatar_url} name={c.username} size={reply ? 24 : 28} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-xs font-semibold text-foreground">
          <span className="truncate">{c.username}</span>
          <BadgeList badges={toBadges(c.user_id, c.badge, c.role)} size={12} />
        </p>
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">{c.content}</p>
        <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
          <button onClick={() => onReply(c)} className="font-semibold hover:text-foreground">Répondre</button>
          {canDelete && (
            <button onClick={() => onDelete(c.id)} disabled={deleting} aria-label="Supprimer le commentaire" className="hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <button onClick={() => onLike(c)} aria-label="J'aime ce commentaire" className="flex flex-col items-center gap-0.5 self-start px-1 pt-1 text-muted-foreground">
        <Heart className={`h-4 w-4 ${c.liked_by_me ? "fill-red-500 text-red-500" : ""}`} />
        <span className="text-[11px]">{c.like_count > 0 ? c.like_count : ""}</span>
      </button>
    </div>
  );
}

// ---------- Commentaires (feuille du bas), aussi utilisée par les vidéos du fil classique ----------
export function ShortComments({
  shortId,
  open,
  isOwner,
  onClose,
  onCountChange,
}: {
  shortId: string | null;
  open: boolean;
  isOwner: boolean;
  onClose: () => void;
  onCountChange: (count: number) => void;
}) {
  useBackHandler(onClose, open);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ShortComment | null>(null);
  const key = ["shortComments", shortId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => fetchShortComments(shortId as string),
    enabled: open && !!shortId,
  });

  // Le compteur de la vidéo suit toujours la vraie liste (ajout, suppression d'un commentaire et de ses réponses)
  const total = list.data?.length;
  useEffect(() => {
    if (open && typeof total === "number") onCountChange(total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, open]);

  useEffect(() => {
    if (!open) {
      setText("");
      setReplyTo(null);
    }
  }, [open]);

  const add = useMutation({
    mutationFn: () => addShortComment(shortId as string, text.trim(), replyTo?.id ?? null),
    onSuccess: () => {
      setText("");
      setReplyTo(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (commentId: string) => deleteShortComment(commentId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });
  const like = useMutation({
    mutationFn: (c: ShortComment) => toggleShortCommentLike(c.id),
    onMutate: async (c) => {
      // Le coeur réagit tout de suite
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ShortComment[]>(key);
      qc.setQueryData<ShortComment[]>(key, (old) =>
        old?.map((x) => (x.id === c.id ? { ...x, liked_by_me: !x.liked_by_me, like_count: Math.max(0, x.like_count + (x.liked_by_me ? -1 : 1)) } : x)),
      );
      return { prev };
    },
    onError: (e: Error, _c, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(e.message);
    },
    onSuccess: (r, c) => {
      qc.setQueryData<ShortComment[]>(key, (old) => old?.map((x) => (x.id === c.id ? { ...x, liked_by_me: r.liked, like_count: r.like_count } : x)));
    },
  });

  const { roots, replies } = useMemo(() => {
    const all = list.data ?? [];
    const byParent = new Map<string, ShortComment[]>();
    for (const c of all) if (c.parent_id) byParent.set(c.parent_id, [...(byParent.get(c.parent_id) ?? []), c]);
    return { roots: all.filter((c) => !c.parent_id), replies: byParent };
  }, [list.data]);

  function startReply(c: ShortComment) {
    setReplyTo(c);
    setText((t) => (t ? t : `@${c.username} `));
  }
  const canDelete = (c: ShortComment) => c.user_id === user?.id || isOwner;
  const rowProps = { deleting: del.isPending, onLike: (c: ShortComment) => like.mutate(c), onReply: startReply, onDelete: (id: string) => del.mutate(id), onClose };

  if (!open || !shortId || typeof document === "undefined") return null;
  // Affichée dans <body> : sinon elle passerait sous la barre du bas de l'application
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="animate-fade-in absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="animate-sheet-up relative flex max-h-[80dvh] w-full max-w-md flex-col rounded-t-3xl border-t border-border bg-card">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <p className="text-base font-bold text-foreground">Commentaires{total ? ` (${total})` : ""}</p>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-[8rem] flex-1 overflow-y-auto px-4">
          {list.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : list.error ? (
            <p className="py-8 text-center text-sm text-destructive">Impossible de charger les commentaires.</p>
          ) : roots.length ? (
            roots.map((c) => (
              <div key={c.id}>
                <CommentRow c={c} canDelete={canDelete(c)} {...rowProps} />
                {(replies.get(c.id) ?? []).map((r) => (
                  <CommentRow key={r.id} c={r} reply canDelete={canDelete(r)} {...rowProps} />
                ))}
              </div>
            ))
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">Aucun commentaire. Lance la discussion !</p>
          )}
        </div>
        {replyTo && (
          <div className="flex items-center justify-between border-t border-border bg-secondary/50 px-4 py-1.5 text-xs text-muted-foreground">
            <span className="truncate">Réponse à @{replyTo.username}</span>
            <button onClick={() => { setReplyTo(null); setText(""); }} aria-label="Annuler la réponse" className="p-1"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            placeholder={replyTo ? "Ta réponse…" : "Ajouter un commentaire…"}
            className="min-w-0 flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground outline-none focus:border-primary"
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim() && !add.isPending) add.mutate();
            }}
          />
          <button
            onClick={() => add.mutate()}
            disabled={!text.trim() || add.isPending}
            aria-label="Envoyer"
            className="brand-gradient flex h-9 w-9 items-center justify-center rounded-full text-primary-foreground disabled:opacity-50"
          >
            {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Menu « ⋮ » d'une vidéo (comme sur Reels) ----------
function MenuRow({ icon: Icon, label, onClick, danger, right }: { icon: LucideIcon; label: string; onClick: () => void; danger?: boolean; right?: ReactNode }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-4 px-5 py-2.5 text-left text-sm active:bg-secondary ${danger ? "text-destructive" : "text-foreground"}`}>
      <Icon className="h-5 w-5 shrink-0" />
      <span className="flex-1">{label}</span>
      {right}
    </button>
  );
}

function ShortMenu({
  item,
  autoScroll,
  setAutoScroll,
  onClose,
  onShare,
  onCopy,
  onSave,
  onFullscreen,
  onDownload,
  onToggleDownload,
  onHide,
  onReport,
}: {
  item: ShortItem;
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
  onClose: () => void;
  onShare: () => void;
  onCopy: () => void;
  onSave: () => void;
  onFullscreen: () => void;
  onDownload: () => void;
  onToggleDownload: () => void;
  onHide: () => void;
  onReport: () => void;
}) {
  useBackHandler(onClose, true);
  const canDownload = item.mine || item.allow_download !== false;
  const close = (fn: () => void) => () => {
    onClose();
    fn();
  };
  if (typeof document === "undefined") return null;
  // Affiché dans <body> : sinon il serait coincé dans la zone de la vidéo et passerait sous la barre du bas
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="animate-fade-in absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="animate-sheet-up relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-border bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))] text-foreground">
        <div className="mx-auto mb-2 mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/40" />
        <div className="grid grid-cols-3 gap-2 px-4 pb-3 pt-1 text-center">
          <button onClick={close(onShare)} className="flex flex-col items-center gap-1.5 rounded-xl py-2 active:bg-secondary">
            <Share2 className="h-6 w-6" />
            <span className="text-xs font-semibold">Partager</span>
          </button>
          <button onClick={close(onCopy)} className="flex flex-col items-center gap-1.5 rounded-xl py-2 active:bg-secondary">
            <Link2 className="h-6 w-6" />
            <span className="text-xs font-semibold">Lien</span>
          </button>
          <button onClick={close(onSave)} className="flex flex-col items-center gap-1.5 rounded-xl py-2 active:bg-secondary">
            <Bookmark className={`h-6 w-6 ${item.saved ? "fill-current" : ""}`} />
            <span className="text-xs font-semibold">{item.saved ? "Enregistrée" : "Enregistrer"}</span>
          </button>
        </div>
        <MenuRow
          icon={Play}
          label="Défilement automatique"
          onClick={() => setAutoScroll(!autoScroll)}
          right={
            <span role="switch" aria-checked={autoScroll} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${autoScroll ? "bg-primary" : "bg-muted-foreground/40"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${autoScroll ? "left-[22px]" : "left-0.5"}`} />
            </span>
          }
        />
        <MenuRow icon={Maximize2} label="Voir en plein écran" onClick={close(onFullscreen)} />
        {canDownload && <MenuRow icon={Download} label="Télécharger" onClick={close(onDownload)} />}
        {item.mine && (
          <MenuRow
            icon={item.allow_download === false ? Download : Ban}
            label={item.allow_download === false ? "Autoriser le téléchargement" : "Interdire le téléchargement"}
            onClick={close(onToggleDownload)}
          />
        )}
        {!item.mine && <MenuRow icon={EyeOff} label="Ça ne m'intéresse pas" onClick={close(onHide)} />}
        {!item.mine && <MenuRow icon={Flag} label="Signaler" danger onClick={close(onReport)} />}
        <div className="mt-1 flex items-start gap-4 border-t border-border px-5 py-3 text-sm">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="min-w-0 flex-1">
            Est-ce que quelque chose ne fonctionne pas ?{" "}
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Problème sur K-Short")}`} className="font-semibold text-primary">
              Dites-le nous
            </a>
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Une vidéo plein écran ----------
function ShortSlide({
  item,
  active,
  near,
  muted,
  setMuted,
  autoScroll,
  setAutoScroll,
  hasNext,
  onNext,
  onPatch,
  onOpenComments,
  onFollow,
  onReport,
}: {
  item: ShortItem;
  active: boolean;
  near: boolean;
  muted: boolean;
  setMuted: (m: boolean) => void;
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
  hasNext: boolean;
  onNext: () => void;
  onPatch: (id: string, patch: Patch) => void;
  onOpenComments: (id: string) => void;
  onFollow: (authorId: string, status: ShortFollow) => void;
  onReport: (id: string) => void;
}) {
  const qc = useQueryClient();
  const sectionRef = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [likesOpen, setLikesOpen] = useState(false);
  const viewed = useRef(false);
  const [fs, setFs] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ wasPlaying: boolean } | null>(null);
  const [scrub, setScrub] = useState<{ cur: number; dur: number } | null>(null);
  const refetching = useRef(false);
  const [src, setSrc] = useState(item.video_url);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setSrc(item.video_url);
  }, [item.video_url]);

  // Lecture uniquement pour la vidéo visible à l'écran
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
      v.muted = muted;
      const p = v.play();
      if (p) {
        p.then(() => setPaused(false)).catch(() => {
          // Le téléphone refuse le son automatique : on lance sans le son
          v.muted = true;
          setMuted(true);
          v.play().then(() => setPaused(false)).catch(() => setPaused(true));
        });
      }
    } else {
      v.pause();
      try {
        v.currentTime = 0;
      } catch {
        /* vidéo pas encore chargée : on ignore */
      }
      setPaused(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, src]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted;
  }, [muted]);

  // Pause quand l'application passe en arrière-plan
  useEffect(() => {
    if (!active) return;
    const onVisibility = () => {
      const v = videoRef.current;
      if (!v) return;
      if (document.hidden) v.pause();
      else void v.play().catch(() => setPaused(true));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [active]);

  // L'adresse de lecture est temporaire (~30 min) : si elle expire, on en demande une nouvelle
  function onVideoError() {
    if (refetching.current) return;
    refetching.current = true;
    fetchShort(item.id)
      .then((s) => {
        if (s.video_url) setSrc(s.video_url);
        else onPatch(item.id, { gone: true });
      })
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 404 || e.status === 410)) {
          toast.info("Cette vidéo n'est plus disponible");
          onPatch(item.id, { gone: true });
        }
      })
      .finally(() => {
        window.setTimeout(() => {
          refetching.current = false;
        }, 5000);
      });
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  }

  const lastTime = useRef(0);
  // Temps réellement regardé sur le passage en cours (hors déplacements du curseur) : envoyé au serveur en quittant la vidéo
  const played = useRef(0);

  function setBarPercent(pct: number) {
    const p = Math.min(100, Math.max(0, pct));
    if (barRef.current) barRef.current.style.width = `${p}%`;
    if (thumbRef.current) thumbRef.current.style.left = `${p}%`;
  }

  /** Barre de progression : on pose ou on glisse le doigt pour avancer / reculer dans la vidéo. */
  function seekFromPointer(e: React.PointerEvent<HTMLDivElement>) {
    const v = videoRef.current;
    const track = trackRef.current;
    if (!v || !track || !v.duration) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / (rect.width || 1)));
    v.currentTime = ratio * v.duration;
    lastTime.current = v.currentTime; // un retour en arrière à la main n'est pas une nouvelle lecture
    setBarPercent(ratio * 100);
    setScrub({ cur: v.currentTime, dur: v.duration });
  }

  function onScrubStart(e: React.PointerEvent<HTMLDivElement>) {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = { wasPlaying: !v.paused };
    v.pause();
    seekFromPointer(e);
  }

  function onScrubMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragging.current) seekFromPointer(e);
  }

  function onScrubEnd() {
    const d = dragging.current;
    dragging.current = null;
    setScrub(null);
    const v = videoRef.current;
    if (d?.wasPlaying && v) void v.play().catch(() => setPaused(true));
  }

  function onTime() {
    const v = videoRef.current;
    const b = barRef.current;
    if (v && b && v.duration && !dragging.current) setBarPercent((v.currentTime / v.duration) * 100);
    // Vidéo qui repart en boucle (temps qui retombe près de 0 après avoir été près de la fin) = nouvelle lecture
    if (v && v.loop && v.duration && lastTime.current > v.duration * 0.6 && v.currentTime < v.duration * 0.3) countPlay();
    if (v && !dragging.current && !v.paused) {
      const delta = v.currentTime - lastTime.current;
      if (delta > 0 && delta < 1.5) played.current += delta;
    }
    if (v) lastTime.current = v.currentTime;
  }

  const like = useMutation({
    mutationFn: () => toggleShortLike(item.id),
    onSuccess: (r) => onPatch(item.id, { liked: r.liked, like_count: r.like_count }),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteShort(item.id),
    onSuccess: () => {
      toast.success("Vidéo supprimée");
      onPatch(item.id, { gone: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Chaque lecture compte (pas pour l'auteur) : la vidéo reste affichée 1,5 s, et on recompte chaque fois qu'on y revient ou qu'elle repart en boucle
  function countPlay() {
    if (item.mine) return;
    recordShortView(item.id)
      .then((r) => onPatch(item.id, { view_count: r.view_count }))
      .catch(() => undefined);
  }

  useEffect(() => {
    if (!active) {
      viewed.current = false; // quand on revient sur la vidéo, c'est une nouvelle lecture
      return;
    }
    if (item.mine || viewed.current) return;
    const t = window.setTimeout(() => {
      viewed.current = true;
      countPlay();
    }, 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, item.id, item.mine]);

  // Signal pour le flux personnalisé : temps regardé, envoyé quand on quitte la vidéo ou que l'appli passe en arrière-plan.
  // Moins de 0,4 s = simple défilement rapide, on n'envoie rien. Pas de signal pour ses propres vidéos.
  useEffect(() => {
    if (!active || item.mine) return;
    played.current = 0;
    let lastSent = -1;
    const flush = () => {
      const secs = played.current;
      if (secs < 0.4 || secs - lastSent < 0.5) return;
      lastSent = secs;
      const v = videoRef.current;
      const dur = v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : item.duration_seconds ?? 0;
      void recordShortWatch(item.id, secs, dur > 0 && secs >= dur * 0.9).catch(() => undefined);
    };
    const onHide = () => {
      if (document.hidden) flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, item.id, item.mine]);

  // ---------- Plein écran (rotation automatique pour une vidéo horizontale) ----------
  type Orientation = { lock?: (o: string) => Promise<void>; unlock?: () => void };
  useEffect(() => {
    const onFs = () => {
      const on = document.fullscreenElement === sectionRef.current;
      setFs(on);
      if (!on) {
        try {
          (screen.orientation as unknown as Orientation)?.unlock?.();
        } catch {
          /* rien à faire */
        }
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement === sectionRef.current) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  async function enterFullscreen() {
    const el = sectionRef.current;
    if (!el?.requestFullscreen) {
      toast.info("Plein écran indisponible sur cet appareil");
      return;
    }
    try {
      await el.requestFullscreen();
      const v = videoRef.current;
      if (v && v.videoWidth >= v.videoHeight) await (screen.orientation as unknown as Orientation)?.lock?.("landscape");
    } catch {
      /* plein écran refusé, ou rotation non autorisée : on garde ce qui a marché */
    }
  }
  // Bouton retour d'Android : sort du plein écran avant de quitter la page
  useBackHandler(() => void document.exitFullscreen().catch(() => undefined), fs);

  const repost = useMutation({
    mutationFn: () => toggleShortRepost(item.id),
    onSuccess: (r) => {
      onPatch(item.id, { reposted: r.reposted, repost_count: r.repost_count });
      toast(r.reposted ? "Vidéo republiée" : "Republication annulée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: () => toggleShortSave(item.id),
    onSuccess: (r) => {
      onPatch(item.id, { saved: r.saved });
      void qc.invalidateQueries({ queryKey: ["savedShorts"] });
      toast(r.saved ? "Vidéo enregistrée" : "Retirée de tes enregistrements");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const hide = useMutation({
    mutationFn: () => hideShort(item.id),
    onSuccess: () => {
      onPatch(item.id, { gone: true });
      toast("Tu verras moins de vidéos comme celle-ci", {
        action: {
          label: "Annuler",
          onClick: () => void unhideShort(item.id).then(() => onPatch(item.id, { gone: false })).catch((e: Error) => toast.error(e.message)),
        },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const allowDownload = useMutation({
    mutationFn: (allow: boolean) => setShortDownload(item.id, allow),
    onSuccess: (r) => {
      onPatch(item.id, { allow_download: r.allow_download });
      toast.success(r.allow_download ? "Téléchargement autorisé" : "Téléchargement interdit");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const follow = useMutation({
    mutationFn: () => toggleFollow(item.author!.username, (item.follow_status ?? "none") as Relationship),
    onSuccess: (status) => {
      onFollow(item.author!.id, status as ShortFollow);
      toast.success(status === "pending" ? "Demande d'abonnement envoyée" : status === "accepted" ? `Tu suis @${item.author!.username}` : `Tu ne suis plus @${item.author!.username}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const shareVideo = () => void shareLink({ url: publicUrl(`/?k=${item.id}`), title: "K-Short sur Kalchat", text: item.caption ?? "Regarde cette vidéo sur Kalchat" });
  function onRepost() {
    if (item.mine) {
      toast.info("Tu ne peux pas republier ta propre vidéo");
      return;
    }
    repost.mutate();
  }

  const author = item.author;
  const name = author ? displayName({ username: author.username, first_name: author.first_name, last_name: author.last_name }) : "Membre";
  const railBottom = "calc(6rem + env(safe-area-inset-bottom))";
  const infoBottom = "calc(5.5rem + env(safe-area-inset-bottom))";

  return (
    <section ref={sectionRef} className="relative h-full w-full snap-start snap-always overflow-hidden bg-black">
      {near && src ? (
        <video
          ref={videoRef}
          src={src}
          className="absolute inset-0 h-full w-full object-contain"
          playsInline
          loop={!autoScroll}
          muted={muted}
          preload={active ? "auto" : "metadata"}
          onClick={togglePlay}
          onError={onVideoError}
          onTimeUpdate={onTime}
          onEnded={() => {
            // Défilement automatique : à la fin de la vidéo on passe à la suivante (sur la dernière, on la rejoue)
            if (!autoScroll) return;
            if (hasNext) onNext();
            else {
              const v = videoRef.current;
              if (v) {
                v.currentTime = 0;
                countPlay();
                void v.play().catch(() => setPaused(true));
              }
            }
          }}
        />
      ) : null}

      {paused && active && (
        <button onClick={togglePlay} aria-label="Lecture" className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-black/50 text-white">
          <Play className="h-8 w-8 fill-white" />
        </button>
      )}

      {fs ? (
        <button
          onClick={() => void document.exitFullscreen().catch(() => undefined)}
          aria-label="Quitter le plein écran"
          className="absolute left-3 top-3 z-10 rounded-full bg-black/50 p-2 text-white"
          style={{ top: "calc(0.75rem + env(safe-area-inset-top))" }}
        >
          <X className="h-5 w-5" />
        </button>
      ) : (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />

          {/* Barre de progression aux couleurs Kalchat, qu'on peut faire glisser (zone tactile large pour la saisir facilement) */}
          <div
            role="slider"
            aria-label="Progression de la vidéo"
            aria-valuemin={0}
            aria-valuemax={100}
            onPointerDown={onScrubStart}
            onPointerMove={onScrubMove}
            onPointerUp={onScrubEnd}
            onPointerCancel={onScrubEnd}
            className="absolute inset-x-0 z-10 flex h-7 touch-none items-center"
            style={{ bottom: "calc(4.6rem + env(safe-area-inset-bottom) - 0.75rem)" }}
          >
            <div ref={trackRef} className={`relative w-full rounded-full bg-white/25 transition-[height] ${scrub ? "h-1.5" : "h-[2px]"}`}>
              <div ref={barRef} className="brand-gradient h-full w-0 rounded-full" />
              <div
                ref={thumbRef}
                className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow-[0_0_10px_var(--glow)] transition-all ${scrub ? "scale-125 opacity-100" : "scale-0 opacity-0"}`}
                style={{ left: "0%" }}
              />
            </div>
            {scrub && (
              <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
                {fmtTime(scrub.cur)} / {fmtTime(scrub.dur)}
              </span>
            )}
          </div>

          {/* Boutons à droite (comme sur Reels) */}
          <div className="absolute right-3 flex flex-col items-center gap-4 text-white" style={{ bottom: railBottom }}>
            <div className="flex flex-col items-center">
              <button onClick={() => like.mutate()} disabled={like.isPending} aria-label="J'aime" className="p-0.5">
                <Heart className={`h-7 w-7 drop-shadow ${item.liked ? "fill-red-500 text-red-500" : ""}`} />
              </button>
              <button onClick={() => setLikesOpen(true)} aria-label="Voir qui a aimé" className="px-2 py-0.5 text-xs font-semibold drop-shadow">
                {item.like_count}
              </button>
            </div>
            <button onClick={() => onOpenComments(item.id)} aria-label="Commentaires" className="flex flex-col items-center gap-0.5">
              <MessageCircle className="h-7 w-7 drop-shadow" />
              <span className="text-xs font-semibold drop-shadow">{item.comment_count}</span>
            </button>
            <button onClick={onRepost} disabled={repost.isPending} aria-label={item.reposted ? "Annuler la republication" : "Republier"} aria-pressed={!!item.reposted} className="flex flex-col items-center gap-0.5">
              <Repeat2 className={`h-7 w-7 drop-shadow ${item.reposted ? "text-green-400" : ""}`} />
              <span className="text-xs font-semibold drop-shadow">{item.repost_count ?? 0}</span>
            </button>
            <button onClick={() => setSendOpen(true)} aria-label="Envoyer à un contact" className="flex flex-col items-center gap-0.5">
              <Send className="h-7 w-7 drop-shadow" />
            </button>
            <button onClick={() => setMenuOpen(true)} aria-label="Plus d'options" className="p-1">
              <EllipsisVertical className="h-6 w-6 drop-shadow" />
            </button>
            <button onClick={() => setMuted(!muted)} aria-label={muted ? "Activer le son" : "Couper le son"} className="rounded-full bg-black/40 p-2">
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            {item.mine && (
              <button
                onClick={() => {
                  if (window.confirm("Supprimer cette vidéo ? Elle disparaîtra immédiatement.")) remove.mutate();
                }}
                disabled={remove.isPending}
                aria-label="Supprimer ma vidéo"
                className="rounded-full bg-black/40 p-2"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            )}
          </div>

          {/* Infos en bas à gauche */}
          <div className="absolute left-4 right-20 text-white" style={{ bottom: infoBottom }}>
            {author && (
              <div className="flex items-center gap-2">
                <Link to="/u/$username" params={{ username: author.username }} aria-label={`Profil de ${name}`} className="shrink-0 rounded-full ring-2 ring-white/80">
                  <Avatar url={author.avatar_url} name={name} size={36} />
                </Link>
                <Link to="/u/$username" params={{ username: author.username }} className="min-w-0 truncate text-sm font-bold drop-shadow hover:underline">
                  {name}
                </Link>
                <BadgeList badges={toBadges(author.id, author.badge, author.role)} size={14} />
                {!item.mine && (
                  <button
                    onClick={() => {
                      if (item.follow_status === "accepted" && !window.confirm(`Ne plus suivre @${author.username} ?`)) return;
                      follow.mutate();
                    }}
                    disabled={follow.isPending}
                    className={`shrink-0 rounded-md border px-2.5 py-0.5 text-xs font-semibold ${item.follow_status === "none" || !item.follow_status ? "border-white/80 text-white" : "border-white/40 text-white/80"}`}
                  >
                    {item.follow_status === "accepted" ? "Abonné" : item.follow_status === "pending" ? "Demandé" : "Suivre"}
                  </button>
                )}
              </div>
            )}
            {item.caption && (
              <p onClick={() => setExpanded(!expanded)} className={`mt-1 whitespace-pre-wrap break-words text-sm drop-shadow ${expanded ? "" : "line-clamp-2"}`}>
                {item.caption}
              </p>
            )}
            <p className="mt-1 flex items-center gap-1 text-[11px] text-white/70">
              <Clock className="h-3 w-3" /> Disparaît dans {timeLeft(item.expires_at)}
            </p>
          </div>
        </>
      )}

      {likesOpen && <ShortLikesSheet shortId={item.id} onClose={() => setLikesOpen(false)} />}

      {sendOpen && <ShortSendSheet shortId={item.id} caption={item.caption} onClose={() => setSendOpen(false)} />}

      {menuOpen && (
        <ShortMenu
          item={item}
          autoScroll={autoScroll}
          setAutoScroll={setAutoScroll}
          onClose={() => setMenuOpen(false)}
          onShare={shareVideo}
          onCopy={() => void copyLink(publicUrl(`/?k=${item.id}`))}
          onSave={() => save.mutate()}
          onFullscreen={() => void enterFullscreen()}
          onDownload={() => void downloadShort(item.id).catch((e: Error) => toast.error(e.message))}
          onToggleDownload={() => allowDownload.mutate(item.allow_download === false)}
          onHide={() => hide.mutate()}
          onReport={() => onReport(item.id)}
        />
      )}
    </section>
  );
}

// ---------- Section K-Short ----------
function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

export function ShortsFeed({ header, startId }: { header: ReactNode; startId?: string | null }) {
  const { user } = useAuth();
  const scroller = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(false);
  // Réglage « défilement automatique » : retenu sur le téléphone
  const autoScroll = useShortsAutoScroll();
  const setAutoScroll = setShortsAutoScroll;
  const [patches, setPatches] = useState<Record<string, Patch>>({});
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reportFor, setReportFor] = useState<string | null>(null);
  // Abonnement à un auteur : valable pour toutes ses vidéos affichées
  const [follows, setFollows] = useState<Record<string, ShortFollow>>({});

  const feed = useInfiniteQuery({
    queryKey: ["shorts", "feed", user?.id],
    queryFn: ({ pageParam }) => fetchShortsFeed(pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!user,
    // Le flux est personnalisé et change à chaque demande : on ne le recharge pas en revenant sur la fenêtre, sinon les vidéos
    // changeraient sous les doigts. Il se renouvelle quand la page est quittée un moment, ou après une publication.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Vidéo ouverte depuis un lien de partage
  const start = useQuery({
    queryKey: ["shorts", "one", startId],
    queryFn: () => fetchShort(startId as string),
    enabled: !!startId && !!user,
    retry: false,
  });
  useEffect(() => {
    if (start.error instanceof ApiError && start.error.status === 410) toast.info("Cette vidéo a expiré");
    else if (start.error instanceof ApiError && start.error.status === 404) toast.info("Cette vidéo n'est plus disponible");
  }, [start.error]);

  const list = useMemo(() => {
    // Sécurité : une même vidéo ne doit jamais apparaître deux fois dans la liste
    const seen = new Set<string>();
    const base = (feed.data?.pages ?? []).flatMap((p) => p.items).filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
    const all = start.data && !base.some((b) => b.id === start.data!.id) ? [start.data, ...base] : base;
    return all
      .filter((i) => !patches[i.id]?.gone)
      .map((i) => {
        const merged = { ...i, ...(patches[i.id] ?? {}) } as ShortItem;
        const f = i.author ? follows[i.author.id] : undefined;
        return f ? { ...merged, follow_status: f } : merged;
      });
  }, [feed.data, start.data, patches, follows]);

  // Charge la suite quand on approche de la fin
  useEffect(() => {
    if (active >= list.length - 3 && feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, list.length, feed.hasNextPage, feed.isFetchingNextPage]);

  function onScroll() {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const el = scroller.current;
      if (!el || !el.clientHeight) return;
      setActive(Math.round(el.scrollTop / el.clientHeight));
    });
  }

  // Touche « Accueil » pressée pendant qu'on est dans K-Short : retour à la première vidéo
  useEffect(() => {
    const top = () => scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
    window.addEventListener("kalchat:shorts-top", top);
    return () => window.removeEventListener("kalchat:shorts-top", top);
  }, []);

  function goNext() {
    const el = scroller.current;
    if (el) el.scrollTo({ top: (active + 1) * el.clientHeight, behavior: "smooth" });
  }

  function patch(id: string, p: Patch) {
    setPatches((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...p } }));
  }

  const commentTarget = list.find((i) => i.id === commentsFor) ?? null;

  return (
    <div className="fixed inset-y-0 left-1/2 z-30 flex w-full max-w-md -translate-x-1/2 flex-col bg-background">
      {/* Barre d'onglets (Pour vous / Abonnements / K-Short / Communautés) dans la bande noire du haut, au-dessus de la vidéo */}
      <div className="relative z-10 shrink-0 bg-background">{header}</div>

      <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="no-scrollbar h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain">
        {feed.isLoading ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
        ) : feed.error && !list.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-foreground">
            <p className="text-sm">Impossible de charger K-Short.</p>
            <button onClick={() => void feed.refetch()} className="rounded-full border border-border px-5 py-2 text-sm font-semibold">Réessayer</button>
          </div>
        ) : list.length ? (
          list.map((item, i) => (
            <ShortSlide
              key={item.id}
              item={item}
              active={i === active}
              near={Math.abs(i - active) <= 1}
              muted={muted}
              setMuted={setMuted}
              autoScroll={autoScroll}
              setAutoScroll={setAutoScroll}
              hasNext={i < list.length - 1}
              onNext={goNext}
              onPatch={patch}
              onOpenComments={setCommentsFor}
              onFollow={(authorId, status) => setFollows((prev) => ({ ...prev, [authorId]: status }))}
              onReport={setReportFor}
            />
          ))
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-foreground">
            <p className="text-base font-bold">Aucune vidéo pour le moment</p>
            <p className="text-sm text-muted-foreground">Sois le premier à publier une vidéo K-Short !</p>
            <button onClick={() => setUploadOpen(true)} className="brand-gradient mt-2 rounded-full px-6 py-2.5 text-sm font-bold text-primary-foreground">Publier une vidéo</button>
          </div>
        )}
        {feed.isFetchingNextPage && (
          <div className="flex h-16 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        )}
      </div>

      <button
        onClick={() => setUploadOpen(true)}
        className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-bold text-black shadow-[0_2px_12px_rgba(0,0,0,0.6)] ring-2 ring-black/30 active:scale-95"
      >
        <Plus className="h-4 w-4" strokeWidth={3} /> Publier
      </button>
      </div>

      <ShortComments
        shortId={commentsFor}
        open={!!commentsFor}
        isOwner={!!commentTarget?.mine}
        onClose={() => setCommentsFor(null)}
        onCountChange={(n) => commentsFor && patch(commentsFor, { comment_count: n })}
      />
      {reportFor && createPortal(<ReportSheet type="short" targetId={reportFor} onClose={() => setReportFor(null)} />, document.body)}
      <ShortUploadSheet open={uploadOpen} onClose={() => setUploadOpen(false)} onPublished={() => void feed.refetch()} />
    </div>
  );
}
