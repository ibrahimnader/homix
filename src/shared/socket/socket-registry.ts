/**
 * `users.socketIds` keeps the socket.io ids a user is currently connected with, so notifications can be pushed to
 * every open tab. It used to grow without bound (the disconnect handler could not find the user, so ids were never
 * removed) and reached ~25 KB per user — which was then downloaded by EVERY authenticated request, because the
 * auth lookup selects all user columns. These helpers keep the list small and duplicate-free.
 */
export const MAX_SOCKETS_PER_USER = 10;

/** Adds a socket id (moved to the end if already present) and keeps only the most recent MAX_SOCKETS_PER_USER ids. */
export const addSocketId = (current: readonly string[] | null | undefined, socketId: string): string[] => {
  const withoutDuplicate = (current ?? []).filter((id) => id !== socketId);
  return [...withoutDuplicate, socketId].slice(-MAX_SOCKETS_PER_USER);
};

/** Removes a socket id; always returns a new array. */
export const removeSocketId = (current: readonly string[] | null | undefined, socketId: string): string[] =>
  (current ?? []).filter((id) => id !== socketId);
