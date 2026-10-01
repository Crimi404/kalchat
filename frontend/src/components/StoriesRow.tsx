import { Plus, Trash2, X, Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { deleteStory, fetchStoryGroups, markStoryViewed, storyViewCount, type StoryGroup } from "@/lib/stories";
import { timeAgo } from "@/lib/social";
import { BadgeList } from "@/components/KalBadge";

function Avatar({ url, name, size = 56 }: { url: string | null; name: string; size?: number }) {
  return url ? (
    <img src={url} alt={name} width={size} height={size} style={{ width: size, height: size }} className="rounded-full object-cover" />
  ) : (
    <span style={{ width: size, height: size }} className="brand-gradient flex items-center justify-center rounded-full font-bold text-primary-foreground">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function StoryViewer({ group, onClose }: { group: StoryGroup; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [i, setI] = useState(0);
  const s = group.stories[i];
  const mine = user?.id === group.author.id;
  const views = useQuery({ queryKey: ["storyViews", s?.id], queryFn: () => storyViewCount(s!.id), enabled: mine && !!s });

  useEffect(() => {
    if (!s || !user) return;
    if (!mine && !s.seen) void markStoryViewed(s.id);
    const t = setTimeout(() => (i < group.stories.length - 1 ? setI(i + 1) : onClose()), 6000);
    return () => clearTimeout(t);
  }, [s, i, user, mine, group.stories.length, onClose]);

  const del = useMutation({
    mutationFn: () => deleteStory(s!.id),
    onSuccess: () => { toast.success("Story supprimée"); qc.invalidateQueries({ queryKey: ["stories"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!s) return null;
  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="relative h-full w-full max-w-md">
        <div className="absolute inset-x-3 top-3 z-10 flex gap-1">
          {group.stories.map((x, k) => (
            <span key={x.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span className={`block h-full bg-foreground ${k < i ? "w-full" : k === i ? "animate-[grow_6s_linear_forwards] w-0" : "w-0"}`} />
            </span>
          ))}
        </div>
        <div className="absolute inset-x-3 top-6 z-10 flex items-center gap-2">
          <Avatar url={group.author.avatar_url} name={group.author.display_name} size={34} />
          <span className="text-sm font-bold text-foreground">{group.author.display_name}</span>
          <BadgeList badges={group.author.badges} size={14} />
          <span className="text-xs text-muted-foreground">{timeAgo(s.created_at)}</span>
          <span className="flex-1" />
          {mine && (
            <>
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Eye className="h-4 w-4" />{views.data ?? 0}</span>
              <button aria-label="Supprimer la story" onClick={() => del.mutate()} className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 className="h-5 w-5" /></button>
            </>
          )}
          <button aria-label="Fermer" onClick={onClose} className="p-1.5 text-foreground"><X className="h-6 w-6" /></button>
        </div>
        <div className="flex h-full items-center justify-center">
          {s.image_url ? (
            <div className="relative w-full">
              {s.media_type === "video" ? (
                <video src={s.image_url} autoPlay muted playsInline loop className="max-h-[85vh] w-full object-contain" />
              ) : (
                <img src={s.image_url} alt="Story" className="max-h-[85vh] w-full object-contain" />
              )}
              {s.content && <p className="absolute inset-x-4 bottom-6 rounded-xl bg-background/70 p-3 text-center text-sm text-foreground backdrop-blur">{s.content}</p>}
            </div>
          ) : (
            <div className="brand-gradient flex h-full w-full items-center justify-center p-8">
              <p className="whitespace-pre-wrap text-center text-2xl font-bold text-primary-foreground">{s.content}</p>
            </div>
          )}
        </div>
        <button aria-label="Précédente" className="absolute bottom-0 left-0 top-20 w-1/3" onClick={() => setI(Math.max(0, i - 1))} />
        <button aria-label="Suivante" className="absolute bottom-0 right-0 top-20 w-1/3" onClick={() => (i < group.stories.length - 1 ? setI(i + 1) : onClose())} />
      </div>
    </div>
  );
}

export function StoriesRow() {
  const { user, profile } = useAuth();
  const q = useQuery({ queryKey: ["stories", user?.id], queryFn: () => fetchStoryGroups(user!.id), enabled: !!user });
  const [open, setOpen] = useState<StoryGroup | null>(null);
  if (!user) return null;
  const groups = q.data ?? [];

  return (
    <>
      <div className="no-scrollbar flex gap-3 overflow-x-auto border-b border-border px-4 py-3">
        <Link to="/story" className="flex w-16 shrink-0 flex-col items-center gap-1.5">
          <span className="relative rounded-full border-2 border-dashed border-border p-[3px]">
            <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name ?? "?"} />
            <span className="brand-gradient absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full text-primary-foreground ring-2 ring-background">
              <Plus className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
          </span>
          <span className="text-[11px] text-muted-foreground">Ajouter</span>
        </Link>
        {groups.map((g) => (
          <button key={g.author.id} onClick={() => setOpen(g)} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
            <span className={`rounded-full p-[2.5px] ${g.allSeen ? "bg-muted" : "story-ring"}`}>
              <span className="block rounded-full bg-background p-[2.5px]">
                <Avatar url={g.author.avatar_url} name={g.author.display_name} />
              </span>
            </span>
            <span className="max-w-full truncate text-[11px] text-muted-foreground">
              {g.author.id === user.id ? "Ma story" : g.author.display_name}
            </span>
          </button>
        ))}
      </div>
      {open && <StoryViewer group={open} onClose={() => { setOpen(null); void q.refetch(); }} />}
    </>
  );
}
