import { api } from "@/lib/api";

export type CommunityRole = "owner" | "admin" | "member";
export type CommunityStatus = "active" | "pending";
export type JoinMode = "open" | "approval";

export interface Community {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  join_mode: JoinMode;
  owner_id: string;
  created_at: string;
  member_count: number;
  my_role: CommunityRole | null;
  my_status: CommunityStatus | null;
  pending_count: number;
}

export interface CommunityMember {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  role: CommunityRole;
  status: CommunityStatus;
}

// PostgreSQL renvoie les COUNT en texte : on les convertit
function shape(c: Community): Community {
  return { ...c, member_count: Number(c.member_count) || 0, pending_count: Number(c.pending_count) || 0 };
}

export const isActiveMember = (c: Community | undefined) => c?.my_status === "active";
export const isCommunityManager = (c: Community | undefined) => c?.my_status === "active" && (c.my_role === "owner" || c.my_role === "admin");

export async function fetchCommunities(q = ""): Promise<Community[]> {
  const rows = await api<Community[]>(`/communities${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return rows.map(shape);
}

export async function fetchCommunity(id: string): Promise<Community> {
  return shape(await api<Community>(`/communities/${encodeURIComponent(id)}`));
}

export async function createCommunity(input: { name: string; description: string; join_mode: JoinMode; avatar_url?: string | null }): Promise<Community> {
  return shape(await api<Community>("/communities", { method: "POST", body: input }));
}

export async function updateCommunity(id: string, input: { name?: string; description?: string; join_mode?: JoinMode; avatar_url?: string | null }): Promise<Community> {
  return shape(await api<Community>(`/communities/${encodeURIComponent(id)}`, { method: "PATCH", body: input }));
}

export async function deleteCommunity(id: string) {
  await api(`/communities/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function joinCommunity(id: string): Promise<{ status: CommunityStatus }> {
  return api(`/communities/${encodeURIComponent(id)}/join`, { method: "POST" });
}

export async function leaveCommunity(id: string) {
  await api(`/communities/${encodeURIComponent(id)}/leave`, { method: "DELETE" });
}

export async function fetchCommunityMembers(id: string): Promise<{ members: CommunityMember[]; pending: CommunityMember[] }> {
  return api(`/communities/${encodeURIComponent(id)}/members`);
}

export type MemberAction = "approve" | "reject" | "remove" | "promote" | "demote";

export async function manageCommunityMember(id: string, userId: string, action: MemberAction) {
  await api(`/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: "PATCH", body: { action } });
}

export function memberDisplayName(m: Pick<CommunityMember, "first_name" | "last_name" | "username">) {
  return [m.first_name, m.last_name].filter(Boolean).join(" ") || m.username;
}
