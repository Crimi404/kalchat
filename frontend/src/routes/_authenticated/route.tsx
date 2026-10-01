import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getToken } from "@/lib/api";

// Routes privées : sans jeton de connexion, retour vers la page de connexion.
// (La vérification réelle du jeton est faite par le serveur à chaque appel API.)
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: "/auth" });
  },
  component: () => <Outlet />,
});
