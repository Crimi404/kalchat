import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { getToken } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { StoriesRow } from "@/components/StoriesRow";
import { PostCard } from "@/components/PostCard";
import { BottomNav } from "@/components/BottomNav";
import { useAuth } from "@/lib/auth";
import { fetchFeed } from "@/lib/social";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: "/auth" });
  },
  head: () => ({
    meta: [
      { title: "Kalchat — Ta vibe, ta communauté" },
      { name: "description", content: "Kalchat est l'application de messagerie sociale qui combine communication, liberté, confidentialité et innovation." },
      { property: "og:title", content: "Kalchat — Ta vibe, ta communauté" },
      { property: "og:description", content: "Discute, partage et connecte avec ta communauté sur Kalchat." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FeedPage,
});

function FeedPage() {
  const { user, loading } = useAuth();
  const feed = useQuery({ queryKey: ["feed", user?.id], queryFn: () => fetchFeed(), enabled: !loading });

  return (
    <div className="app-shell">
      <TopBar title="Kalchat" subtitle="Ta vibe, ta communauté" />
      <StoriesRow />
      <main className="pb-28">
        {user && (
          <Link to="/nouveau" className="mx-4 my-3 block rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground hover:bg-secondary/60">
            Quoi de neuf ?
          </Link>
        )}
        {feed.isLoading || loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : feed.error ? (
          <p className="py-16 text-center text-sm text-destructive">Impossible de charger le fil.</p>
        ) : feed.data?.length ? (
          feed.data.map((post) => <PostCard key={post.id} post={post} />)
        ) : (
          <div className="px-6 py-16 text-center">
            <p className="font-semibold text-foreground">Aucune publication pour le moment</p>
            <p className="mt-1 text-sm text-muted-foreground">{user ? "Sois le premier à partager quelque chose !" : "Connecte-toi pour publier."}</p>
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
