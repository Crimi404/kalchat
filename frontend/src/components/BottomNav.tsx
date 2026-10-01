import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Compass, MessageCircle, User, Plus } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { fetchUnreadTotal } from "@/lib/chat";
import { CreateMenu } from "./CreateMenu";

const items = [
  { to: "/", label: "Accueil", icon: Home },
  { to: "/explorer", label: "Explorer", icon: Compass },
] as const;

const itemsRight = [
  { to: "/messages", label: "Messages", icon: MessageCircle, badge: 0 },
  { to: "/profil", label: "Profil", icon: User },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [createOpen, setCreateOpen] = useState(false);
  const { user } = useAuth();
  const unread = useQuery({ queryKey: ["unread", user?.id], queryFn: () => fetchUnreadTotal(), enabled: !!user });

  const renderItem = (item: (typeof items)[number] | (typeof itemsRight)[number]) => {
    const active = pathname === item.to;
    const Icon = item.icon;
    return (
      <Link
        key={item.to}
        to={item.to}
        className="relative flex flex-col items-center gap-0.5 px-3 py-1"
      >
        <span className="relative">
          <Icon
            className={`h-6 w-6 transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}
            strokeWidth={active ? 2.4 : 1.8}
          />
          {item.to === "/messages" && unread.data ? (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-like px-1 text-[10px] font-bold text-white">
              {unread.data > 9 ? "9+" : unread.data}
            </span>
          ) : null}
        </span>
        <span
          className={`text-[10px] font-medium transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}
        >
          {item.label}
        </span>
        {active && <span className="absolute -bottom-1 h-0.5 w-8 rounded-full brand-gradient" />}
      </Link>
    );
  };

  return (
    <>
      <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="flex items-end justify-around px-2 pt-2">
          {items.map(renderItem)}
          <button
            onClick={() => setCreateOpen(true)}
            aria-label="Créer"
            className="brand-gradient glow-primary -mt-6 flex h-14 w-14 items-center justify-center rounded-full text-primary-foreground transition-transform active:scale-90"
          >
            <Plus className="h-7 w-7" strokeWidth={2.5} />
          </button>
          {itemsRight.map(renderItem)}
        </div>
      </nav>
      <CreateMenu open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
