import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { StoryViewer } from "@/components/StoriesRow";
import { useAuth } from "@/lib/auth";
import { fetchStoryGroups, OPEN_STORY_EVENT, type StoryGroup } from "@/lib/stories";

/** Ouvre une story précise quand on appuie sur la carte d'une réponse. Si elle n'existe plus, on le dit simplement. */
export function StoryOpenHost() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState<{ group: StoryGroup; startId: string } | null>(null);

  useEffect(() => {
    const onOpen = async (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!user || !id) return;
      try {
        // Données fraîches : la story a pu expirer ou être supprimée depuis le dernier chargement
        const groups = await qc.fetchQuery({ queryKey: ["stories", user.id], queryFn: () => fetchStoryGroups(user.id), staleTime: 0 });
        const group = groups.find((g) => g.stories.some((s) => s.id === id));
        if (group) setOpen({ group, startId: id });
        else toast.info("Cette story n'est plus disponible");
      } catch {
        toast.error("Impossible d'ouvrir la story pour le moment");
      }
    };
    window.addEventListener(OPEN_STORY_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_STORY_EVENT, onOpen);
  }, [user, qc]);

  if (!open) return null;
  return (
    <StoryViewer
      group={open.group}
      startId={open.startId}
      onClose={() => { setOpen(null); void qc.invalidateQueries({ queryKey: ["stories"] }); }}
    />
  );
}
