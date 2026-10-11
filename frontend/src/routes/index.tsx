import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ShortsFeed } from "@/components/ShortsFeed";
import { useBackHandler } from "@/lib/back";
import { ShortFeedCard } from "@/components/ShortFeedCard";
import { fetchInFeedShorts, fetchShortsStatus, type ShortItem } from "@/lib/shorts";
import type { FeedPost } from "@/lib/social";

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

type FeedTab = "foryou" | "following" | "shorts" | "communities";
const TABS: { key: FeedTab; label: string }[] = [
  { key: "foryou", label: "Pour vous" },
  { key: "following", label: "Abonnements" },
  { key: "shorts", label: "K-Short" },
  { key: "communities", label: "Communautés" },
];

function readTab(): FeedTab {
  try {
    const v = sessionStorage.getItem("kalchat:feedTab");
    return v === "following" || v === "communities" || v === "shorts" ? v : "foryou";
  } catch {
    return "foryou";
  }
}

/** Vidéo ouverte depuis un lien de partage (/?k=identifiant). */
function readStartShort(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("k");
  } catch {
    return null;
  }
}

type FeedEntry = { kind: "post"; post: FeedPost } | { kind: "short"; short: ShortItem };

/** Glisse les vidéos « aussi dans le fil » parmi les publications, sans changer l'ordre des publications. */
function mixShorts(posts: FeedPost[], shorts: ShortItem[]): FeedEntry[] {
  const vids = [...shorts].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const out: FeedEntry[] = [];
  let vi = 0;
  for (const post of posts) {
    const t = Date.parse(post.created_at) || 0;
    while (vi < vids.length && Date.parse(vids[vi].published_at) >= t) out.push({ kind: "short", short: vids[vi++] });
    out.push({ kind: "post", post });
  }
  while (vi < vids.length) out.push({ kind: "short", short: vids[vi++] });
  return out;
}

function FeedPage() {
  const { user, loading } = useAuth();
  const [tab, setTabState] = useState<FeedTab>(() => (readStartShort() ? "shorts" : readTab()));
  const [startShortId, setStartShortId] = useState<string | null>(readStartShort);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const qc = useQueryClient();
  // Touche « Accueil » : remonte en haut et actualise le fil
  useEffect(() => {
    const onHome = () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      window.dispatchEvent(new Event("kalchat:shorts-top"));
      void qc.invalidateQueries({ queryKey: ["feed"] });
      void qc.invalidateQueries({ queryKey: ["shorts"] });
      void qc.invalidateQueries({ queryKey: ["stories"] });
    };
    window.addEventListener("kalchat:home-tap", onHome);
    return () => window.removeEventListener("kalchat:home-tap", onHome);
  }, [qc]);
  function setTab(t: FeedTab) {
    setTabState(t);
    try { sessionStorage.setItem("kalchat:feedTab", t); } catch { /* stockage indisponible : on ignore */ }
  }
  // « Ouvrir dans K-Short » depuis une vidéo du fil
  useEffect(() => {
    const open = (e: Event) => {
      setStartShortId((e as CustomEvent<string>).detail);
      setTab("shorts");
    };
    window.addEventListener("kalchat:open-short", open);
    return () => window.removeEventListener("kalchat:open-short", open);
  }, []);
  // K-Short n'apparaît que si le serveur l'a activé (stockage R2 configuré)
  const shortsStatus = useQuery({ queryKey: ["shortsStatus"], queryFn: fetchShortsStatus, enabled: !!user, staleTime: 5 * 60_000, retry: false });
  const shortsOn = !!user && shortsStatus.data?.enabled === true;
  const visibleTabs = TABS.filter((t) => t.key !== "shorts" || shortsOn);
  // Les visiteurs non connectés ne voient que le fil public
  const activeTab: FeedTab = user ? (tab === "shorts" && !shortsOn ? "foryou" : tab) : "foryou";
  // Bouton retour d'Android dans K-Short : on quitte l'onglet (retour au fil « Pour vous ») au lieu de fermer l'application
  useBackHandler(() => setTab("foryou"), activeTab === "shorts");
  const feed = useQuery({
    queryKey: ["feed", user?.id ?? "guest", activeTab],
    queryFn: () => (!user ? fetchPublicFeed() : activeTab === "following" ? fetchFollowingFeed() : fetchFeed()),
    enabled: !loading && activeTab !== "communities" && activeTab !== "shorts",
  });
  const inFeedShorts = useQuery({
    queryKey: ["shorts", "in-feed", user?.id],
    queryFn: fetchInFeedShorts,
    enabled: shortsOn && activeTab === "foryou",
    staleTime: 60_000,
    retry: false,
  });
  const mixed = useMemo(() => mixShorts(feed.data ?? [], activeTab === "foryou" && shortsOn ? inFeedShorts.data ?? [] : []), [feed.data, inFeedShorts.data, activeTab, shortsOn]);

  // Barre d'onglets : Pour vous / Abonnements / K-Short / Communautés (version claire dans l'accueil, version sur fond vidéo dans K-Short)
  const renderTabs = (overlay: boolean) => (
    <div className={`flex items-center ${overlay ? "pt-[env(safe-area-inset-top)]" : "border-b border-border"}`}>
      {visibleTabs.map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          aria-pressed={activeTab === t.key}
          className={`relative flex-1 py-3 font-semibold transition-colors ${visibleTabs.length > 3 ? "text-[13px]" : "text-sm"} ${
            activeTab === t.key ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {t.label}
          {activeTab === t.key && <span className={`absolute bottom-0 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-primary`} />}
        </button>
      ))}
      {!overlay && activeTab === "foryou" && (
        <button onClick={() => setPrefsOpen(true)} aria-label="Personnaliser mon fil" className="px-3 py-3 text-muted-foreground hover:text-foreground">
          <SlidersHorizontal className="h-5 w-5" />
        </button>
      )}
    </div>
  );

  // Section K-Short : lecteur vertical plein écran (la barre du bas reste disponible)
  if (user && activeTab === "shorts") {
    return (
      <div className="app-shell">
        <ShortsFeed header={renderTabs(true)} startId={startShortId} />
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TopBar title="Kalchat" subtitle="Ta vibe, ta communauté" />
      <StoriesRow />
      {user && renderTabs(false)}
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
        ) : mixed.length ? (
          mixed.map((entry) => (entry.kind === "post" ? <PostCard key={entry.post.id} post={entry.post} /> : <ShortFeedCard key={`short-${entry.short.id}`} short={entry.short} />))
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
