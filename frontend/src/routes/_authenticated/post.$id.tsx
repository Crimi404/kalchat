import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { PostCard } from "@/components/PostCard";
import { useAuth } from "@/lib/auth";
import { fetchPost } from "@/lib/social";

export const Route = createFileRoute("/_authenticated/post/$id")({
  head: () => ({
    meta: [
      { title: "Publication — Kalchat" },
      { name: "description", content: "Publication Kalchat et ses commentaires." },
    ],
  }),
  component: PostPage,
});

function PostPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const router = useRouter();
  const q = useQuery({ queryKey: ["post", id, user?.id], queryFn: () => fetchPost(id), enabled: !!user, retry: false });

  function goBack() {
    if (window.history.length > 1) router.history.back();
    else void router.navigate({ to: "/" });
  }

  return (
    <div className="app-shell">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/90 px-3 py-3 backdrop-blur-xl">
        <button aria-label="Retour" onClick={goBack} className="rounded-full p-2 hover:bg-secondary"><ArrowLeft className="h-5 w-5" /></button>
        <h1 className="text-base font-bold text-foreground">Publication</h1>
      </header>
      <main className="pb-28">
        {q.isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : q.data ? (
          <PostCard post={q.data} detail />
        ) : (
          <p className="mx-auto max-w-xs py-20 text-center text-sm text-muted-foreground">Cette publication n'existe plus ou n'est pas accessible.</p>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
