// @deno-types="npm:@types/node-telegram-bot-api"
import TelegramBot from "node-telegram-bot-api";

try {
  const { load } = await import("https://deno.land/std@0.224.0/dotenv/mod.ts");
  const env = await load({ export: true });
  console.log("Loaded .env variables:", Object.keys(env));
} catch {
  // .env may not exist in production environments
}

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const WEBHOOK_SECRET_TOKEN = Deno.env.get("WEBHOOK_SECRET_TOKEN");
const DENO_ENV = Deno.env.get("DENO_ENV") || "development";
const IN_DEV_MODE = DENO_ENV === "development";

console.log("TELEGRAM_BOT_TOKEN:", TELEGRAM_BOT_TOKEN ? "✅ Loaded" : "❌ Missing");
console.log("WEBHOOK_SECRET_TOKEN:", WEBHOOK_SECRET_TOKEN ? "✅ Loaded" : "❌ Missing");
console.log(`Environment Mode: 🚀 ${DENO_ENV}`);

if (!TELEGRAM_BOT_TOKEN || !WEBHOOK_SECRET_TOKEN) {
  throw new Error("Missing environment variables");
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: IN_DEV_MODE });
const WEBHOOK_PATH = `/${WEBHOOK_SECRET_TOKEN}`;

const channelSignatures: Record<string, string> = {};

interface UserSession {
  action: "set" | "change" | "remove";
  step: "AWAITING_SIGNATURE" | "AWAITING_CHANNEL";
  signature?: string;
}

const userSessions: Record<number, UserSession> = {};

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
    const rawKey = entry.key[1] as string;
    const signature = entry.value as string;
    console.log(`🔑 Stored KV Signature -> Channel Key: "${rawKey}" | Signature: "${signature}"`);

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

// Helper to parse Markdown links [text](url) in signatures and convert to Telegram MessageEntities
interface ProcessedSignature {
  displayText: string;
  entities: TelegramBot.MessageEntity[];
}

function processSignatureLinks(signature: string): ProcessedSignature {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let displayText = "";
  let lastIndex = 0;
  const entities: TelegramBot.MessageEntity[] = [];

  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(signature)) !== null) {
    const beforeText = signature.slice(lastIndex, match.index);
    displayText += beforeText;

    const linkText = match[1];
    const url = match[2];
    const offset = displayText.length;
    const length = linkText.length;

    entities.push({
      type: "text_link",
      offset,
      length,
      url,
    });

    displayText += linkText;
    lastIndex = linkRegex.lastIndex;
  }

  displayText += signature.slice(lastIndex);

  return { displayText, entities };
}

// Combines original text/caption with processed signature & merges entities
function combineMessageWithSignature(
  originalText: string | undefined,
  originalEntities: TelegramBot.MessageEntity[] | undefined,
  signatureRaw: string
): { text: string; entities?: TelegramBot.MessageEntity[] } {
  const { displayText: sigText, entities: sigEntities } = processSignatureLinks(signatureRaw);

  const baseText = originalText || "";
  const combinedText = baseText ? `${baseText}\n\n${sigText}` : sigText;

  const sigOffset = baseText ? baseText.length + 2 : 0;

  const shiftedSigEntities = sigEntities.map((e) => ({
    ...e,
    offset: e.offset + sigOffset,
  }));

  const allEntities = [...(originalEntities || []), ...shiftedSigEntities];

  return {
    text: combinedText,
    entities: allEntities.length > 0 ? allEntities : undefined,
  };
}

// ==================== KEYBOARDS & UI HELPERS ====================
const getMainMenuKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [
        { text: "📌 Set Signature", callback_data: "cmd_set" },
        { text: "🔁 Change Signature", callback_data: "cmd_change" },
      ],
      [
        { text: "❌ Remove Signature", callback_data: "cmd_remove" },
        { text: "📋 Active Signatures", callback_data: "cmd_list" },
      ],
    ],
  },
});

const startSignatureFlow = (userId: number, chatId: number, action: "set" | "change", signatureInput?: string) => {
  if (signatureInput && signatureInput.trim()) {
    userSessions[userId] = { action, step: "AWAITING_CHANNEL", signature: signatureInput.trim() };
    bot.sendMessage(
      chatId,
      `✅ Signature: "*${signatureInput.trim()}*"\n\n📌 *Step 2/2: Select Channel*\n\nPlease **forward a post** from the target channel, or send the channel username/ID (e.g. \`@aydus_journal\` or \`24315194535\`).`,
      { parse_mode: "Markdown" }
    );
  } else {
    userSessions[userId] = { action, step: "AWAITING_SIGNATURE" };
    bot.sendMessage(
      chatId,
      `📌 *Step 1/2: Enter Signature*\n\nPlease reply with the signature text you'd like to use.\n\n*Hyperlinks Supported!* You can use Markdown links like:\n\`[My Channel](https://t.me/aydus_journal)\` or \`Made with 💙 by [Ayida](https://t.me/aydus_journal)\`\n\n_(Type /cancel anytime to exit)_`,
      { parse_mode: "Markdown" }
    );
  }
};

const startRemoveFlow = (userId: number, chatId: number) => {
  userSessions[userId] = { action: "remove", step: "AWAITING_CHANNEL" };
  bot.sendMessage(
    chatId,
    `❌ *Remove Signature*\n\nPlease **forward a post** from the channel, or send the channel username/ID (e.g. \`@aydus_journal\` or \`24315194535\`).\n\n_(Type /cancel anytime to exit)_`,
    { parse_mode: "Markdown" }
  );
};

// ==================== WEBHOOK HANDLER ====================
const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  if (req.method === "POST" && url.pathname === WEBHOOK_PATH) {
    const secretHeader = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (secretHeader && secretHeader !== WEBHOOK_SECRET_TOKEN) {
      console.warn("⚠️ Unauthorized webhook request: Invalid secret token");
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      const update = await req.json();
      await bot.processUpdate(update);
      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Webhook error:", error);
      return new Response("Error", { status: 500 });
    }
  }
  return new Response("Not Found", { status: 404 });
};

// ==================== BOT SETUP ====================
if (!IN_DEV_MODE) {
  const domain = Deno.env.get("DENO_PROJECT_DOMAIN") || "signature-bot.ayida-aman.deno.net";
  const WEBHOOK_URL = `https://${domain}${WEBHOOK_PATH}`;
  await bot.setWebHook(WEBHOOK_URL, { secret_token: WEBHOOK_SECRET_TOKEN });
  console.log(`✅ Webhook set to: ${WEBHOOK_URL}`);
} else {
  try {
    await bot.deleteWebHook();
  } catch (e) {
    console.log("Webhook cleanup note:", e instanceof Error ? e.message : e);
  }
  console.log("🚀 Running in polling mode (development)");
}

// ==================== COMMANDS ====================
bot.onText(/\/start|\/menu/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `👋 *Welcome to SignatureBot!*

I automatically append custom signatures (with hyperlink support!) to all posts in your channels.

Choose an option below to get started:`;
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: "Markdown", ...getMainMenuKeyboard() });
});

bot.onText(/\/cancel/, (msg) => {
  const userId = msg.from?.id || msg.chat.id;
  delete userSessions[userId];
  bot.sendMessage(msg.chat.id, "❌ Action cancelled.", getMainMenuKeyboard());
});

bot.onText(/\/set_signature(?:\s+(.+))?/, (msg, match) => {
  const userId = msg.from?.id || msg.chat.id;
  startSignatureFlow(userId, msg.chat.id, "set", match?.[1]);
});

bot.onText(/\/change_signature(?:\s+(.+))?/, (msg, match) => {
  const userId = msg.from?.id || msg.chat.id;
  startSignatureFlow(userId, msg.chat.id, "change", match?.[1]);
});

bot.onText(/\/remove_signature/, (msg) => {
  const userId = msg.from?.id || msg.chat.id;
  startRemoveFlow(userId, msg.chat.id);
});

// ==================== BUTTON CALLBACK HANDLER ====================
bot.on("callback_query", async (query) => {
  const userId = query.from.id;
  const chatId = query.message?.chat.id;
  if (!chatId) return;

  try {
    await bot.answerCallbackQuery(query.id);
  } catch {
    // Ignore callback query answer timeout
  }

  switch (query.data) {
    case "cmd_set":
      startSignatureFlow(userId, chatId, "set");
      break;
    case "cmd_change":
      startSignatureFlow(userId, chatId, "change");
      break;
    case "cmd_remove":
      startRemoveFlow(userId, chatId);
      break;
    case "cmd_list": {
      await loadSignatures();
      const entries = Object.entries(channelSignatures);

      if (entries.length === 0) {
        await bot.sendMessage(chatId, "ℹ️ No signatures are currently saved.");
      } else {
        let listText = `📋 *Active Channel Signatures (${entries.length}):*\n\n`;
        for (const [id, sig] of entries) {
          let title = id;
          try {
            const chat = await bot.getChat(id);
            title = chat.title ? `${chat.title} (\`${id}\`)` : `\`${id}\``;
          } catch {
            title = `\`${id}\``;
          }
          listText += `• *${title}*\n  Signature: "${sig}"\n\n`;
        }
        await bot.sendMessage(chatId, listText, { parse_mode: "Markdown" });
      }
      break;
    }
  }
});

// ==================== INTERACTIVE MESSAGE HANDLER ====================
bot.on("message", async (msg) => {
  if (msg.text?.startsWith("/")) return;

  const userId = msg.from?.id || msg.chat.id;
  const chatId = msg.chat.id;
  const session = userSessions[userId];

  if (!session) return;

  // Step 1: User provides the signature text
  if (session.step === "AWAITING_SIGNATURE") {
    if (!msg.text) {
      await bot.sendMessage(chatId, "❌ Please send your signature as a text message.");
      return;
    }
    const signature = msg.text.trim();
    session.signature = signature;
    session.step = "AWAITING_CHANNEL";

    await bot.sendMessage(
      chatId,
      `✅ Signature set to:\n"${signature}"\n\n📌 *Step 2/2: Select Channel*\n\nNow please **forward a post** from the channel or type its username/ID (e.g. \`@aydus_journal\` or \`24315194535\`).`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Step 2: User provides the channel (via forward or text input)
  if (session.step === "AWAITING_CHANNEL") {
    let rawTarget: string | undefined;

    if (msg.forward_from_chat && msg.forward_from_chat.id) {
      rawTarget = msg.forward_from_chat.id.toString();
    } else if (msg.text) {
      const input = msg.text.trim();
      if (input.startsWith("@") || input.startsWith("-100")) {
        rawTarget = input;
      } else if (/^\d+$/.test(input)) {
        rawTarget = `-100${input}`;
      } else {
        rawTarget = `@${input}`;
      }
    }

    if (!rawTarget) {
      await bot.sendMessage(chatId, "🚫 Please forward a message from the channel or provide a valid channel ID/username.");
      return;
    }

    let channelId: string;
    let channelDisplay = rawTarget;
    try {
      const chat = await bot.getChat(rawTarget);
      channelId = chat.id.toString();
      channelDisplay = chat.title ? chat.title : rawTarget;
    } catch (err) {
      console.error("Failed to resolve chat target:", err);
      await bot.sendMessage(
        chatId,
        `🚫 Could not find channel "${rawTarget}". Make sure the channel exists and the bot has been added as an administrator.`
      );
      delete userSessions[userId];
      return;
    }

    const isAdmin = await isUserAdmin(channelId, userId);
    if (!isAdmin) {
      await bot.sendMessage(chatId, "🚫 You must be an admin or owner of the channel to manage its signature.");
      delete userSessions[userId];
      return;
    }

    if (session.action === "remove") {
      await removeSignature(channelId);
      await bot.sendMessage(chatId, `✅ Signature removed for channel *${channelDisplay}* (\`${channelId}\`)`, { parse_mode: "Markdown" });
    } else if (session.signature) {
      await saveSignature(channelId, session.signature);
      await bot.sendMessage(
        chatId,
        `🎉 *Success!* Signature "${session.signature}" ${session.action === "set" ? "saved" : "updated"} for channel *${channelDisplay}* (\`${channelId}\`).`,
        { parse_mode: "Markdown" }
      );
    }

    delete userSessions[userId];
  }
});

// ==================== CHANNEL POST HANDLER ====================
bot.on("channel_post", async (msg) => {
  const chatId = msg.chat.id.toString();
  const messageId = msg.message_id;

  if (msg.forward_from_chat || msg.forward_from || msg.forward_sender_name) return;

  const signature = channelSignatures[chatId];
  if (!signature) return;

  const isMedia = Boolean(msg.photo || msg.video || msg.document || msg.audio || msg.animation);

  try {
    if (msg.text && !msg.text.includes(signature)) {
      const { text: updatedText, entities: updatedEntities } = combineMessageWithSignature(
        msg.text,
        msg.entities,
        signature
      );

      await bot.editMessageText(updatedText, {
        chat_id: msg.chat.id,
        message_id: messageId,
        entities: updatedEntities,
      } as TelegramBot.EditMessageTextOptions);
      console.log(`Edited text post ${messageId} in ${chatId}`);
    } else if ((msg.caption !== undefined || isMedia) && !(msg.caption && msg.caption.includes(signature))) {
      const { text: updatedCaption, entities: updatedEntities } = combineMessageWithSignature(
        msg.caption,
        msg.caption_entities,
        signature
      );

      await bot.editMessageCaption(updatedCaption, {
        chat_id: msg.chat.id,
        message_id: messageId,
        caption_entities: updatedEntities,
      } as TelegramBot.EditMessageCaptionOptions);
      console.log(`Edited caption on post ${messageId} in ${chatId}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ Edit failed for post ${messageId}: ${error.message}`);
    }
    try {
      await bot.deleteMessage(msg.chat.id, messageId);
      if (msg.text) {
        const { text: updatedText, entities: updatedEntities } = combineMessageWithSignature(
          msg.text,
          msg.entities,
          signature
        );
        await bot.sendMessage(msg.chat.id, updatedText, { entities: updatedEntities });
      } else {
        const { text: updatedCaption, entities: updatedEntities } = combineMessageWithSignature(
          msg.caption,
          msg.caption_entities,
          signature
        );
        const opts = { caption: updatedCaption, caption_entities: updatedEntities };

        if (msg.photo) {
          await bot.sendPhoto(msg.chat.id, msg.photo.at(-1)!.file_id, opts);
        } else if (msg.video) {
          await bot.sendVideo(msg.chat.id, msg.video.file_id, opts);
        } else if (msg.document) {
          await bot.sendDocument(msg.chat.id, msg.document.file_id, opts);
        } else if (msg.audio) {
          await bot.sendAudio(msg.chat.id, msg.audio.file_id, opts);
        } else if (msg.animation) {
          await bot.sendAnimation(msg.chat.id, msg.animation.file_id, opts);
        }
      }
    } catch (fallbackError) {
      if (fallbackError instanceof Error) {
        console.error(`⚠️ Fallback resend failed: ${fallbackError.message}`);
      }
    }
  }
});

// ==================== START SERVER ====================
Deno.serve({ port: 8000, handler });

console.log("🚀 Bot is running...");