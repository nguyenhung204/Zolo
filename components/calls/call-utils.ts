export type ProfileMap = Record<
  string,
  { displayName: string | null; avatarUrl: string | null }
>;

export function resolveDisplayName(
  userId: string,
  profileMap: ProfileMap
): string {
  return profileMap[userId]?.displayName ?? "Unknown";
}

export function resolveAvatarUrl(
  userId: string,
  profileMap: ProfileMap
): string | null {
  return profileMap[userId]?.avatarUrl ?? null;
}

export function is409(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "response" in err &&
    (err as { response?: { status?: number } }).response?.status === 409
  );
}

export function get409Code(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "response" in err
    ? (err as { response?: { data?: { code?: string } } }).response?.data?.code
    : undefined;
}
