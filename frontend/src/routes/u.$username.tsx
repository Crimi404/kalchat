import { createFileRoute, redirect } from "@tanstack/react-router";
import { getToken } from "@/lib/api";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { ProfileView } from "@/components/ProfileView";

export const Route = createFileRoute("/u/$username")({
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: "/auth" });
  },
  head: ({ params }) => ({
    meta: [
      { title: `@${params.username} — Kalchat` },
      { name: "description", content: `Le profil de @${params.username} sur Kalchat.` },
      { property: "og:title", content: `@${params.username} — Kalchat` },
      { property: "og:description", content: `Découvre les publications de @${params.username} sur Kalchat.` },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UserPage,
});

function UserPage() {
  const { username } = Route.useParams();
  return (
    <div className="app-shell">
      <TopBar title="Profil" subtitle={`@${username}`} />
      <main className="pb-28"><ProfileView username={username} /></main>
      <BottomNav />
    </div>
  );
}
