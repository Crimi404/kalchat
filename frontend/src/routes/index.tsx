import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { StoriesRow } from "@/components/StoriesRow";
import { PostCard } from "@/components/PostCard";
import { BottomNav } from "@/components/BottomNav";
import { useAuth } from "@/lib/auth";
import { fetchFeed, fetchPublicFeed } from "@/lib/social";
import logo from "@/assets/kalchat-logo.png";
import { ApkDownload } from "@/components/ApkDownload";
import { EmailBanner } from "@/components/EmailBanner";

export const Route = createFileRoute("/")({
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
  const feed = useQuery({ queryKey: ["feed", user?.id ?? "guest"], queryFn: () => (user ? fetchFeed() : fetchPublicFeed()), enabled: !loading });

  return (
    <div className="app-shell">
      <TopBar title="Kalchat" subtitle="Ta vibe, ta communauté" />
      <StoriesRow />
      <main className="pb-28">
        {!user && !loading && (
          <section className="mx-4 mt-3 rounded-2xl border border-border bg-card p-4 text-center">
            <img src={logo} alt="" width={48} height={48} className="mx-auto h-12 w-12" />
            <h2 className="mt-2 text-base font-bold text-foreground">Bienvenue sur Kalchat</h2>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">Discute, partage et connecte-toi avec ta communauté : messages, stories, publications et bien plus.</p>
            <div className="mt-3 flex gap-2">
              <Link to="/auth" className="brand-gradient glow-primary flex-1 rounded-xl py-2.5 text-sm font-bold text-primary-foreground">Créer un compte</Link>
              <Link to="/auth" className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-foreground hover:bg-secondary">Se connecter</Link>
            </div>
            <ApkDownload variant="button" />
          </section>
        )}
        {user && <EmailBanner />}
        {user && <ApkDownload variant="banner" />}
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
