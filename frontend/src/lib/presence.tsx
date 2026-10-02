import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "@/lib/api";
import { useAuth } from "./auth";

const PresenceContext = createContext<Set<string>>(new Set());

/** Suit qui est en ligne (Socket.io) et rafraîchit messages / notifications dès qu'un événement arrive. */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [online, setOnline] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    if (!socket) return;

    const onPresence = (ids: string[]) => setOnline(new Set(ids));
    const onMessage = () => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["unread"] });
      void qc.invalidateQueries({ queryKey: ["messages"] });
    };
    // Message modifié, supprimé ou épinglé par quelqu'un d'autre : on rafraîchit la conversation ouverte
    const onMessageChanged = () => {
      void qc.invalidateQueries({ queryKey: ["messages"] });
      void qc.invalidateQueries({ queryKey: ["conversation"] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    };
    const onNotification = () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["notifUnread"] });
      // une notification de message met aussi à jour la liste des conversations
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["unread"] });
    };

    socket.on("presence", onPresence);
    socket.on("new_message", onMessage);
    socket.on("notification", onNotification);
    socket.on("conversation_changed", onMessage);
    socket.on("message_edited", onMessageChanged);
    socket.on("message_deleted", onMessageChanged);
    socket.on("message_pinned", onMessageChanged);
    return () => {
      socket.off("presence", onPresence);
      socket.off("new_message", onMessage);
      socket.off("notification", onNotification);
      socket.off("conversation_changed", onMessage);
      socket.off("message_edited", onMessageChanged);
      socket.off("message_deleted", onMessageChanged);
      socket.off("message_pinned", onMessageChanged);
    };
  }, [user, qc]);

  return <PresenceContext.Provider value={online}>{children}</PresenceContext.Provider>;
}

export const useOnline = () => useContext(PresenceContext);
