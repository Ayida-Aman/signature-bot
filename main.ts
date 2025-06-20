// @deno-types="npm:@types/node-telegram-bot-api"
import TelegramBot from "node-telegram-bot-api";

if (Deno.env.get("DENO_ENV") === "development") {
  const { load } = await import("https://deno.land/std@0.224.0/dotenv/mod.ts");
  const env = await load({ export: true });
  console.log("Loaded .env variables:", env);
}

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

async function isUserAdmin(channelId: string, userId: number): Promise<boolean> {
  try {
    const member = await bot.getChatMember(channelId, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch (error) {
    console.error("❌ Failed to verify admin:", error);
    return false;
  }
}

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

if (!IN_DEV_MODE) {
  const WEBHOOK_URL = `https://telegram-signature-bot.deno.dev${WEBHOOK_PATH}`;
  await bot.setWebHook(WEBHOOK_URL, { secret_token: WEBHOOK_SECRET_TOKEN });
  console.log(`Webhook set to ${WEBHOOK_URL}`);
} else {
  await bot.deleteWebHook();
  console.log("Running in polling mode");
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `👋 Welcome to SignatureBot!

This bot appends a signature to your Telegram channel posts.

Commands:
/set_signature <signature> – Set a signature
/change_signature <signature> – Update it
/remove_signature – Delete it

Example: /set_signature @aydus_journal
`;
  bot.sendMessage(chatId, welcomeMessage);
});

bot.onText(/\/set_signature (.+)/, (msg, match) => {
  const userId = msg.chat.id;
  const signature = match?.[1];
  if (signature) {
    awaitingChannelId[userId] = { action: "set", signature };
    bot.sendMessage(
      userId,
      "📌 Please forward a message from the channel you want to set the signature for, or provide the channel ID (e.g., 24315194535).\n\n" +
      "Req: You need to make me and admin first (if you haven't yet) to check the admin status \n\n" +
      "Note: You can use plain text (e.g., @aydus_journey) or multiple hyperlinks in Markdown, e.g., [Channel 1](https://t.me/aydus_journey) [Channel 2](https://t.me/another_channel)"
    );
  } else {
    bot.sendMessage(
      userId,
      "❌ Please provide a signature. Examples:\n" +
      "- Plain text: /set_signature @aydus_journey\n" +
      "- Hyperlinks: /set_signature [Channel 1](https://t.me/aydus_journey) [Channel 2](https://t.me/another_channel)"
    );
  }
});

bot.onText(/\/change_signature (.+)/, (msg, match) => {
  const userId = msg.chat.id;
  const signature = match?.[1];
  if (signature) {
    awaitingChannelId[userId] = { action: "change", signature };
    bot.sendMessage(
      userId,
      "🔁 Please forward a message from the channel you want to update the signature for, or provide the channel ID (e.g., 24315194535).\n\n" +
      "Note: You can use plain text (e.g., @aydus_journey) or multiple hyperlinks in Markdown, e.g., [Channel 1](https://t.me/aydus_journey) [Channel 2](https://t.me/another_channel)"
    );
  } else {
    bot.sendMessage(
      userId,
      "❌ Please provide a new signature. Examples:\n" +
      "- Plain text: /change_signature @aydus_journey\n" +
      "- Hyperlinks: /change_signature [Channel 1](https://t.me/aydus_journey) [Channel 2](https://t.me/another_channel)"
    );
  }
});

bot.onText(/\/remove_signature/, (msg) => {
  const userId = msg.chat.id;
  awaitingChannelId[userId] = { action: "remove" };
  bot.sendMessage(
    userId,
    "❌ Please forward a message from the channel you want to remove the signature from, or provide the channel ID (e.g., 24315194535). Note that I need to be an admin on your channel to check the admin status"
  );
});

bot.on("message", async (msg) => {
  const userId = msg.chat.id;
  const pending = awaitingChannelId[userId];
  if (!pending || (!msg.text && !msg.forward_from_chat)) return;

  let channelId: string | undefined;

  // Handle forwarded message
  if (msg.forward_from_chat && msg.forward_from_chat.id) {
    channelId = msg.forward_from_chat.id.toString();
  }
  // Handle manual channel ID input
  else if (msg.text) {
    channelId = msg.text.trim();
    if (!channelId.startsWith("-100")) {
      channelId = `-100${channelId}`;
    }
  }

  if (!channelId) {
    await bot.sendMessage(userId, "🚫 Please forward a message from the channel or provide a valid channel ID. Note that I need to be an admin on your channel to check the admin status");
    return;
  }

  const isAdmin = await isUserAdmin(channelId, userId);
  if (!isAdmin) {
    await bot.sendMessage(userId, "🚫 You must be an admin or owner of the channel to manage its signature.");
    delete awaitingChannelId[userId];
    return;
  }

  if (pending.action === "remove") {
    await removeSignature(channelId);
    await bot.sendMessage(userId, `✅ Signature removed for channel ${channelId}`);
  } else if (pending.signature) {
    await saveSignature(channelId, pending.signature);
    await bot.sendMessage(
      userId,
      `✅ Signature "${pending.signature}" ${pending.action === "set" ? "saved" : "updated"} for channel ${channelId}`
    );
  }

  delete awaitingChannelId[userId];
});

bot.on("channel_post", async (msg) => {
  console.log("Entities:", msg.entities, "Caption Entities:", msg.caption_entities);
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  if (msg.forward_from_chat || msg.forward_from || msg.forward_sender_name) {
    return;
  }
  const signature = channelSignatures[chatId];

  if (!signature) return;

  const adjustEntities = (
    entities: TelegramBot.MessageEntity[] | undefined,
    textLength: number,
    appendLength: number
  ): TelegramBot.MessageEntity[] => {
    if (!entities) return [];
    return entities.map((entity) => ({
      ...entity,
      offset: entity.offset < textLength ? entity.offset : entity.offset + appendLength,
    }));
  };

  const parseSignature = (signature: string): { text: string; entities: TelegramBot.MessageEntity[] } => {
    const entities: TelegramBot.MessageEntity[] = [];
    let text = signature;
    let offsetAdjustment = 0;

    const hyperlinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    while ((match = hyperlinkRegex.exec(signature)) !== null) {
      const [fullMatch, linkText, url] = match;
      const startIndex = match.index - offsetAdjustment;
      entities.push({
        type: "text_link" as const,
        offset: startIndex,
        length: linkText.length,
        url,
      });
      text = text.slice(0, startIndex) + linkText + text.slice(startIndex + fullMatch.length);
      offsetAdjustment += fullMatch.length - linkText.length;
    }

    return { text, entities };
  };

  try {
    const { text: signatureText, entities: signatureEntities } = parseSignature(signature);

    if (msg.text && !msg.text.includes(signature)) {
      const originalText = msg.text;
      const updatedText = `${originalText}\n\n${signatureText}`;
      const adjustedEntities = adjustEntities(msg.entities, originalText.length, `\n\n${signatureText}`.length).concat(
        signatureEntities.map((entity) => ({
          ...entity,
          offset: entity.offset + originalText.length + 2,
        }))
      );

      await bot.editMessageText(updatedText, {
        chat_id: chatId,
        message_id: messageId,
        entities: adjustedEntities,
      } as TelegramBot.EditMessageTextOptions);
      console.log(`Edited text ${messageId} in ${chatId}`);
    } else if (msg.caption && !msg.caption.includes(signature)) {
      const originalCaption = msg.caption;
      const updatedCaption = `${originalCaption}\n\n${signatureText}`;
      const adjustedEntities = adjustEntities(msg.caption_entities, originalCaption.length, `\n\n${signatureText}`.length).concat(
        signatureEntities.map((entity) => ({
          ...entity,
          offset: entity.offset + originalCaption.length + 2,
        }))
      );

      await bot.editMessageCaption(updatedCaption, {
        chat_id: chatId,
        message_id: messageId,
        caption_entities: adjustedEntities,
      } as TelegramBot.EditMessageCaptionOptions);
      console.log(`Edited caption ${messageId} in ${chatId}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ Edit failed: ${error.message}`);
    }
    try {
      await bot.deleteMessage(chatId, messageId);
      const { text: signatureText, entities: signatureEntities } = parseSignature(signature);
      if (msg.text) {
        const originalText = msg.text;
        const updatedText = `${originalText}\n\n${signatureText}`;
        const adjustedEntities = adjustEntities(msg.entities, originalText.length, `\n\n${signatureText}`.length).concat(
          signatureEntities.map((entity) => ({
            ...entity,
            offset: entity.offset + originalText.length + 2,
          }))
        );

        await bot.sendMessage(chatId, updatedText, {
          entities: adjustedEntities,
        });
      } else if (msg.caption && msg.photo) {
        const originalCaption = msg.caption;
        const updatedCaption = `${originalCaption}\n\n${signatureText}`;
        const adjustedEntities = adjustEntities(msg.caption_entities, originalCaption.length, `\n\n${signatureText}`.length).concat(
          signatureEntities.map((entity) => ({
            ...entity,
            offset: entity.offset + originalCaption.length + 2,
          }))
        );

        await bot.sendPhoto(chatId, msg.photo.at(-1)!.file_id, {
          caption: updatedCaption,
          caption_entities: adjustedEntities,
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

