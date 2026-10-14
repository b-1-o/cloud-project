export type DocumentRole = "owner" | "editor" | "viewer";

export function canRead(role: string): role is DocumentRole {
  return role === "owner" || role === "editor" || role === "viewer";
}
export function canEdit(role: string): role is "owner" | "editor" {
  return role === "owner" || role === "editor";
}
export function normalizeTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim().slice(0, 120);
  return title.length > 0 ? title : null;
}
