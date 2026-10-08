import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { StoriesRow } from "@/components/StoriesRow";
import { PostCard } from "@/components/PostCard";
import { BottomNav } from "@/components/BottomNav";
import { useAuth } from "@/lib/auth";
import { fetchFeed, fetchFollowingFeed, fetchPublicFeed } from "@/lib/social";
import { CommunitiesTab } from "@/components/CommunitiesTab";
import { FeedPrefsSheet } from "@/components/FeedPrefsSheet";
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

type FeedTab = "foryou" | "following" | "communities";
const TABS: { key: FeedTab; label: string }[] = [
  { key: "foryou", label: "Pour vous" },
  { key: "following", label: "Abonnements" },
  { key: "communities", label: "Communautés" },
];

function readTab(): FeedTab {
  try {
    const v = sessionStorage.getItem("kalchat:feedTab");
    return v === "following" || v === "communities" ? v : "foryou";
  } catch {
    return "foryou";
  }
}

function FeedPage() {
  const { user, loading } = useAuth();
  const [tab, setTabState] = useState<FeedTab>(readTab);
  const [prefsOpen, setPrefsOpen] = useState(false);
  function setTab(t: FeedTab) {
    setTabState(t);
    try { sessionStorage.setItem("kalchat:feedTab", t); } catch { /* stockage indisponible : on ignore */ }
  }
  // Les visiteurs non connectés ne voient que le fil public
  const activeTab: FeedTab = user ? tab : "foryou";
  const feed = useQuery({
    queryKey: ["feed", user?.id ?? "guest", activeTab],
    queryFn: () => (!user ? fetchPublicFeed() : activeTab === "following" ? fetchFollowingFeed() : fetchFeed()),
    enabled: !loading && activeTab !== "communities",
  });

  return (
    <div className="app-shell">
      <TopBar title="Kalchat" subtitle="Ta vibe, ta communauté" />
      <StoriesRow />
      {user && (
        <div className="flex items-center border-b border-border">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} aria-pressed={activeTab === t.key} className={`relative flex-1 py-3 text-sm font-semibold transition-colors ${activeTab === t.key ? "text-foreground" : "text-muted-foreground"}`}>
              {t.label}
              {activeTab === t.key && <span className="absolute bottom-0 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-primary" />}
            </button>
          ))}
          {activeTab === "foryou" && (
            <button onClick={() => setPrefsOpen(true)} aria-label="Personnaliser mon fil" className="px-3 py-3 text-muted-foreground hover:text-foreground">
              <SlidersHorizontal className="h-5 w-5" />
            </button>
          )}
        </div>
      )}
      <FeedPrefsSheet open={prefsOpen} onClose={() => setPrefsOpen(false)} />
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
        {user && activeTab !== "communities" && (
          <Link to="/nouveau" className="mx-4 my-3 block rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground hover:bg-secondary/60">
            Quoi de neuf ?
          </Link>
        )}
        {activeTab === "communities" ? (
          <CommunitiesTab />
        ) : feed.isLoading || loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : feed.error ? (
          <p className="py-16 text-center text-sm text-destructive">Impossible de charger le fil.</p>
        ) : feed.data?.length ? (
          feed.data.map((post) => <PostCard key={post.id} post={post} />)
        ) : (
          <div className="px-6 py-16 text-center">
            <p className="font-semibold text-foreground">{activeTab === "following" ? "Ton fil Abonnements est vide" : "Aucune publication pour le moment"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {activeTab === "following" ? "Abonne-toi à des membres pour voir leurs publications ici." : user ? "Sois le premier à partager quelque chose !" : "Connecte-toi pour publier."}
            </p>
            {activeTab === "following" && <Link to="/explorer" className="mt-3 inline-block rounded-full border border-border px-5 py-2 text-sm font-semibold hover:bg-secondary">Découvrir des membres</Link>}
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
