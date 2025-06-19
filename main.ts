// @deno-types="npm:@types/node-telegram-bot-api"
import TelegramBot from "node-telegram-bot-api";

if (Deno.env.get("DENO_ENV") === "development") {
  const { load } = await import("https://deno.land/std@0.224.0/dotenv/mod.ts");
  const env = await load({ export: true });
  console.log("Loaded .env variables:", env);
}
// Environment
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const WEBHOOK_SECRET_TOKEN = Deno.env.get("WEBHOOK_SECRET_TOKEN");
const IN_DEV_MODE = Deno.env.get("DENO_ENV") === "development";
console.log("TELEGRAM_BOT_TOKEN:", TELEGRAM_BOT_TOKEN);
console.log("WEBHOOK_SECRET_TOKEN:", WEBHOOK_SECRET_TOKEN);
if (!TELEGRAM_BOT_TOKEN || !WEBHOOK_SECRET_TOKEN) {
  throw new Error("Missing environment variables");
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
const WEBHOOK_PATH = `/${WEBHOOK_SECRET_TOKEN}`;
const channelSignatures: Record<string, string> = {};
const awaitingChannelId: Record<number, { action: string; signature?: string }> = {};

const kv = await Deno.openKv();

async function loadSignatures() {
  for await (const entry of kv.list({ prefix: ["signatures"] })) {
    channelSignatures[entry.key[1] as string] = entry.value as string;
  }
  console.log("Loaded Signatures:", channelSignatures);
}

async function saveSignature(channelId: string, signature: string) {
  await kv.set(["signatures", channelId], signature);
  channelSignatures[channelId] = signature;
  console.log(`Saved signature for ${channelId}`);
}

async function removeSignature(channelId: string) {
  await kv.delete(["signatures", channelId]);
  delete channelSignatures[channelId];
  console.log(`Removed signature for ${channelId}`);
}

await loadSignatures();

// Set webhook in production
if (!IN_DEV_MODE) {
  const WEBHOOK_URL = `https://<your-deno-project>.deno.dev${WEBHOOK_PATH}`;
  await bot.setWebHook(WEBHOOK_URL, { secret_token: WEBHOOK_SECRET_TOKEN });
  console.log(`Webhook set to ${WEBHOOK_URL}`);
} else {
  await bot.deleteWebHook();
  console.log("Running in polling mode");
}

// Commands
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `👋 Welcome to SignatureBot!

This bot appends a signature to your Telegram channel posts.

Commands:
/set_signature <signature> – Set a signature
/change_signature <signature> – Update it
/remove_signature – Delete it

Example: /set_signature @aydus_journey

After setting, reply with your channel ID like 2431124237.`;
  bot.sendMessage(chatId, welcomeMessage);
});

bot.onText(/\/set_signature (.+)/, (msg, match) => {
  const userId = msg.chat.id;
  const signature = match?.[1];
  if (signature) {
    awaitingChannelId[userId] = { action: "set", signature };
    bot.sendMessage(userId, "📌 Please provide your channel ID.");
  }
});

bot.onText(/\/change_signature (.+)/, (msg, match) => {
  const userId = msg.chat.id;
  const signature = match?.[1];
  if (signature) {
    awaitingChannelId[userId] = { action: "change", signature };
    bot.sendMessage(userId, "🔁 Which channel ID do you want to update?");
  }
});

bot.onText(/\/remove_signature/, (msg) => {
  const userId = msg.chat.id;
  awaitingChannelId[userId] = { action: "remove" };
  bot.sendMessage(userId, "❌ Enter the channel ID to remove its signature.");
});

bot.on("message", async (msg) => {
  const userId = msg.chat.id;
  const pending = awaitingChannelId[userId];
  if (pending && msg.text) {
    let channelId = msg.text.trim();
    if (!channelId.startsWith("-100")) {
      channelId = `-100${channelId}`;
    }

    if (pending.action === "remove") {
      await removeSignature(channelId);
      bot.sendMessage(userId, `✅ Signature removed for ${channelId}`);
    } else if (pending.signature) {
      await saveSignature(channelId, pending.signature);
      bot.sendMessage(
        userId,
        `✅ Signature "${pending.signature}" ${pending.action === "set" ? "saved" : "updated"} for ${channelId}`
      );
    }
    delete awaitingChannelId[userId];
  }
});

// Channel post handler
bot.on("channel_post", async (msg) => {
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const signature = channelSignatures[chatId];

  if (!signature) return;

  try {
    if (msg.text && !msg.text.includes(signature)) {
      const updatedText = `${msg.text}\n\n> ${signature}`;
      await bot.editMessageText(updatedText, { chat_id: chatId, message_id: messageId });
      console.log(`Edited text ${messageId} in ${chatId}`);
    } else if (msg.caption && !msg.caption.includes(signature)) {
      const updatedCaption = `${msg.caption}\n\n> ${signature}`;
      await bot.editMessageCaption(updatedCaption, {
  chat_id: chatId,
  message_id: messageId
});
      console.log(`Edited caption ${messageId} in ${chatId}`);
    }
  } catch (error) {
    if (error instanceof Error) {
  console.error(`❌ Edit failed: ${error.message}`);
}
    try {
      await bot.deleteMessage(chatId, messageId);
      if (msg.text) {
        await bot.sendMessage(chatId, `${msg.text}\n\n> ${signature}`);
      } else if (msg.caption && msg.photo) {
        await bot.sendPhoto(chatId, msg.photo.at(-1)!.file_id, {
          caption: `${msg.caption}\n\n> ${signature}`,
        });
      }
    } catch (fallbackError) {
      if (fallbackError instanceof Error) {
  console.error(`⚠️ Fallback failed: ${fallbackError.message}`);
}
      await bot.sendMessage(chatId, `⚠️ Could not process your message.`);
    }
  }
});

// Webhook server
Deno.serve({ port: 8000 }, async (req) => {
  if (req.method === "POST" && new URL(req.url).pathname === WEBHOOK_PATH) {
    try {
      const update = await req.json();
      bot.processUpdate(update);
      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Webhook error:", error);
      return new Response("Error", { status: 500 });
    }
  }
  return new Response("Not Found", { status: 404 });
});

console.log("Bot is running...");