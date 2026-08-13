// @deno-types="npm:@types/node-telegram-bot-api"
import TelegramBot from "telegram-bot-api";
import { TELEGRAM_BOT_TOKEN, IN_DEV_MODE } from "./config.ts";

export const bot = new TelegramBot(TELEGRAM_BOT_TOKEN!, { polling: IN_DEV_MODE });

/**
 * Checks if a user is an administrator or owner of a given channel.
 */
export async function isUserAdmin(channelId: string, userId: number): Promise<boolean> {
  try {
    const member = await bot.getChatMember(channelId, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch (error) {
    console.error(`❌ Failed to verify admin for user ${userId} in ${channelId}:`, error);
    return false;
  }
}
