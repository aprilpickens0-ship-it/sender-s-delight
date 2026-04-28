// Simple shared-password admin gate. Stored in localStorage after entry.
// NOTE: This is not cryptographically secure — it's a soft gate, as requested.
const KEY = "admin_authed_v1";
export const ADMIN_PASSWORD = "admin123"; // Change this in src/lib/admin-auth.ts

export const isAdminAuthed = () =>
  typeof window !== "undefined" && localStorage.getItem(KEY) === "1";

export const setAdminAuthed = (v: boolean) => {
  if (typeof window === "undefined") return;
  if (v) localStorage.setItem(KEY, "1");
  else localStorage.removeItem(KEY);
};
