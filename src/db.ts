import { bot } from "./bot.ts";
import { UserSession } from "./types.ts";

export const channelSignatures: Record<string, string> = {};
export const userSessions: Record<number, UserSession> = {};

const kv = await Deno.openKv();

/**
 * Loads all signatures from Deno KV into memory and migrates any non-canonical legacy keys.
 */
export async function loadSignatures(): Promise<void> {
  for await (const entry of kv.list({ prefix: ["signatures"] })) {
    const rawKey = entry.key[1] as string;
    const signature = entry.value as string;

    if (/^-100\d+$/.test(rawKey)) {
      channelSignatures[rawKey] = signature;
    } else {
      console.log(`🔄 Migrating legacy KV key: "${rawKey}"...`);
      const target = rawKey.startsWith("-100@") ? rawKey.replace("-100@", "@") : rawKey;
      try {
        const chat = await bot.getChat(target);
        const canonicalId = chat.id.toString();

        await kv.set(["signatures", canonicalId], signature);
        channelSignatures[canonicalId] = signature;

        await kv.delete(["signatures", rawKey]);
        console.log(`✅ Migrated legacy key "${rawKey}" -> "${canonicalId}"`);
      } catch (err) {
        console.warn(`⚠️ Could not resolve legacy key "${rawKey}":`, err instanceof Error ? err.message : err);
        channelSignatures[rawKey] = signature;
      }
    }
  }
  console.log("Loaded Signatures Map:", channelSignatures);
  console.log(`📊 Total active channels: ${Object.keys(channelSignatures).length}`);
}

/**
 * Saves a signature for a given channel ID in Deno KV and memory.
 */
export async function saveSignature(channelId: string, signature: string): Promise<void> {
  await kv.set(["signatures", channelId], signature);
  channelSignatures[channelId] = signature;
  console.log(`Saved signature for channel ${channelId}`);
}

/**
 * Removes a signature for a given channel ID from Deno KV and memory.
 */
export async function removeSignature(channelId: string): Promise<void> {
  await kv.delete(["signatures", channelId]);
  delete channelSignatures[channelId];
  console.log(`Removed signature for channel ${channelId}`);
}

/**
 * Gets active user session from Deno KV (or in-memory cache).
 */
export async function getSession(userId: number): Promise<UserSession | undefined> {
  if (userSessions[userId]) {
    return userSessions[userId];
  }
  const entry = await kv.get<UserSession>(["sessions", userId]);
  if (entry.value) {
    userSessions[userId] = entry.value;
    return entry.value;
  }
  return undefined;
}

/**
 * Saves active user session in Deno KV with a 15-minute expiration timer.
 */
export async function setSession(userId: number, session: UserSession): Promise<void> {
  userSessions[userId] = session;
  // 15 minute expiration for active sessions in KV
  await kv.set(["sessions", userId], session, { expireIn: 15 * 60 * 1000 });
}

/**
 * Deletes user session from Deno KV and memory.
 */
export async function deleteSession(userId: number): Promise<void> {
  delete userSessions[userId];
  await kv.delete(["sessions", userId]);
}
