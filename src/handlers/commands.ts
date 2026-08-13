import { bot, isUserAdmin } from "../bot.ts";
import { saveSignature, removeSignature } from "../db.ts";
import { UserSession } from "../types.ts";

export const userSessions: Record<number, UserSession> = {};

export const getMainMenuKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [
        { text: "📌 Set Signature", callback_data: "cmd_set" },
        { text: "🔁 Change Signature", callback_data: "cmd_change" },
      ],
      [
        { text: "❌ Remove Signature", callback_data: "cmd_remove" },
      ],
    ],
  },
});

export const startSignatureFlow = (userId: number, chatId: number, action: "set" | "change", signatureInput?: string) => {
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
      `📌 *Step 1/2: Enter Signature*\n\nPlease reply with the signature text you'd like to use.\n\n💡 *Multiple Links & Formatting Supported!*\n*Examples:*\n• \`@aydus_journal\`\n• \`Made with 💙 by [Ayida](https://t.me/aydus_journal)\`\n• \`Follow us: [LinkedIn](https://...) | [Telegram](https://...) | [YouTube](https://...)\`\n\n_(Type /cancel anytime to exit)_`,
      { parse_mode: "Markdown" }
    );
  }
};

export const startRemoveFlow = (userId: number, chatId: number) => {
  userSessions[userId] = { action: "remove", step: "AWAITING_CHANNEL" };
  bot.sendMessage(
    chatId,
    `❌ *Remove Signature*\n\nPlease **forward a post** from the channel, or send the channel username/ID (e.g. \`@aydus_journal\` or \`24315194535\`).\n\n_(Type /cancel anytime to exit)_`,
    { parse_mode: "Markdown" }
  );
};

export function setupCommandHandlers(): void {
  // Start & Menu Commands
  bot.onText(/\/start|\/menu/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `👋 *Welcome to SignatureBot!*

I automatically append custom signatures (with multiple hyperlinks support!) to all posts in your channels.

Choose an option below to get started:`;
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: "Markdown", ...getMainMenuKeyboard() });
  });

  // Cancel Command
  bot.onText(/\/cancel/, (msg) => {
    const userId = msg.from?.id || msg.chat.id;
    delete userSessions[userId];
    bot.sendMessage(msg.chat.id, "❌ Action cancelled.", getMainMenuKeyboard());
  });

  // Set / Change / Remove Signature Commands
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

  // Inline Button Callbacks
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
    }
  });

  // Step-by-step Interactive Message Handler
  bot.on("message", async (msg) => {
    if (msg.text?.startsWith("/")) return;

    const userId = msg.from?.id || msg.chat.id;
    const chatId = msg.chat.id;
    const session = userSessions[userId];

    // If user sends a message outside an active session, give them guidance instead of ignoring them
    if (!session) {
      if (msg.chat.type === "private") {
        await bot.sendMessage(
          chatId,
          `👋 *Hi there!*\n\nTo set or manage channel signatures, please choose an option below or send /start:`,
          { parse_mode: "Markdown", ...getMainMenuKeyboard() }
        );
      }
      return;
    }

    // Step 1: User provides the signature text
    if (session.step === "AWAITING_SIGNATURE") {
      if (!msg.text) {
        await bot.sendMessage(
          chatId,
          `❌ *Text Required:* Please send your signature as a text message.\n\n*Example:* \`Follow us: [LinkedIn](https://...) | [Telegram](https://...)\``,
          { parse_mode: "Markdown" }
        );
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
        await bot.sendMessage(
          chatId,
          "🚫 *Invalid Channel Format:* Please forward a message directly from the channel or provide a valid username (e.g. `@aydus_journal`) or channel ID.",
          { parse_mode: "Markdown" }
        );
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
          `❌ *Channel Not Found*\nCould not find channel \`${rawTarget}\`.\n\n📌 *Requirements Checklist:*\n1. Make sure **SignatureBot** is added to the channel as an **Administrator**.\n2. Verify the channel username (e.g. \`@aydus_journal\`) or forward a message directly from the channel.\n\n_Please try forwarding or typing the channel again, or send /cancel to stop._`,
          { parse_mode: "Markdown" }
        );
        // Keep session active so user can retry without restarting from Step 1
        return;
      }

      const isAdmin = await isUserAdmin(channelId, userId);
      if (!isAdmin) {
        await bot.sendMessage(
          chatId,
          `🚫 *Permission Denied*\n\nYou must be an **Administrator or Creator** of *${channelDisplay}* to manage its signature.\n\nMake sure your account is an admin in that channel!`,
          { parse_mode: "Markdown" }
        );
        delete userSessions[userId];
        return;
      }

      if (session.action === "remove") {
        await removeSignature(channelId);
        await bot.sendMessage(
          chatId,
          `✅ Signature removed for channel *${channelDisplay}* (\`${channelId}\`).`,
          { parse_mode: "Markdown" }
        );
      } else if (session.signature) {
        await saveSignature(channelId, session.signature);
        await bot.sendMessage(
          chatId,
          `🎉 *Success!* Signature ${session.action === "set" ? "saved" : "updated"} for channel *${channelDisplay}*!\n\n*Signature:*\n"${session.signature}"\n\nFrom now on, all new posts in *${channelDisplay}* will automatically append your signature.`,
          { parse_mode: "Markdown" }
        );
      }

      delete userSessions[userId];
    }
  });
}
