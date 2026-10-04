import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getToken } from "@/lib/api";
import { rememberDestination } from "@/lib/share";

// Routes privées : sans jeton de connexion, retour vers la page de connexion.
// (La vérification réelle du jeton est faite par le serveur à chaque appel API.)
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ location }) => {
    if (!getToken()) {
      // On garde la page demandée (lien partagé) pour y revenir après la connexion
      rememberDestination(location.href);
      throw redirect({ to: "/auth" });
    }
  },
  component: () => <Outlet />,
});
