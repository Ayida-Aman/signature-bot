// @deno-types="npm:@types/node-telegram-bot-api"
import TelegramBot from "telegram-bot-api";
import { TELEGRAM_BOT_TOKEN, IN_DEV_MODE } from "./config.ts";

export const bot = new TelegramBot(TELEGRAM_BOT_TOKEN!, { polling: IN_DEV_MODE });

export interface AdminCheckResult {
  isAdmin: boolean;
  reason?: "BOT_NOT_ADMIN" | "NOT_ADMIN" | "CHAT_NOT_FOUND";
}

/**
 * Checks if a user is an administrator or owner of a given channel,
 * and distinguishes whether permission issues are due to user rights or bot rights.
 */
export async function isUserAdmin(channelId: string, userId: number): Promise<AdminCheckResult> {
  try {
    const member = await bot.getChatMember(channelId, userId);
    const isAdmin = member.status === "administrator" || member.status === "creator";
    return {
      isAdmin,
      reason: isAdmin ? undefined : "NOT_ADMIN",
    };
  } catch (error) {
    console.error(`❌ Failed to verify admin for user ${userId} in ${channelId}:`, error);
    const errStr = String(error);
    if (
      errStr.includes("CHAT_ADMIN_REQUIRED") ||
      errStr.includes("bot is not a member") ||
      errStr.includes("not in the chat") ||
      errStr.includes("not an admin")
    ) {
      return { isAdmin: false, reason: "BOT_NOT_ADMIN" };
    }
    return { isAdmin: false, reason: "CHAT_NOT_FOUND" };
  }
}
