import { bot, isUserAdmin } from "../bot.ts";
import { saveSignature, removeSignature } from "../db.ts";
import { UserSession } from "../types.ts";
import { validateSignatureFormat } from "../utils/formatting.ts";

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
        { text: "❓ How To Use", callback_data: "cmd_howto" },
      ],
    ],
  },
});

export const sendHowToGuide = (chatId: number) => {
  const guideText = `📖 *How to Use SignatureBot*

SignatureBot automatically appends custom signatures (with clickable links & formatting) to every new post in your Telegram channels!

---
📌 *Step 1: Add Bot to Your Channel*
1. Open your Telegram channel settings.
2. Go to **Administrators** → **Add Administrator**.
3. Search for this bot and grant **Post Messages** permission.

---
📌 *Step 2: Set Your Signature*
1. Tap **📌 Set Signature** or send \`/set_signature\`.
2. Type and send your signature text.

🔗 *Hyperlink Format (Strict Markdown):*
Use \`[Link Text](https://your-url.com)\` with **no spaces or newlines** between \`]\` and \`(\`.

💡 *Examples:*
• \`@aydus_journal\`
• \`Made with 💙 by [Ayida](https://t.me/aydus_journal)\`
• \`Hi us [LinkedIn](https://www.linkedin.com/in/bintaman/) || [Telegram](https://t.me/aydus_gallery)\`

---
📌 *Step 3: Select Your Channel*
1. **Forward any post** from your channel to this chat, OR send your channel username (e.g. \`@aydus_journal\`).
2. Done! All future posts in your channel will automatically append your signature.

---
⚙️ *Management Commands:*
• **Change Signature:** Tap **🔁 Change Signature** or send \`/change_signature\`
• **Remove Signature:** Tap **❌ Remove Signature** or send \`/remove_signature\`
• **Cancel Setup:** Send \`/cancel\` anytime to exit`;

  bot.sendMessage(chatId, guideText, { parse_mode: "Markdown", ...getMainMenuKeyboard() });
};

export const startSignatureFlow = (userId: number, chatId: number, action: "set" | "change", signatureInput?: string) => {
  if (signatureInput && signatureInput.trim()) {
    const validation = validateSignatureFormat(signatureInput.trim());
    if (!validation.isValid) {
      bot.sendMessage(chatId, validation.errorMessage!, { parse_mode: "Markdown" });
      return;
    }
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
      `📌 *Step 1/2: Enter Signature*\n\nPlease reply with the signature text you'd like to use.\n\n💡 *Multiple Links & Formatting Supported!*\n*Examples:*\n• \`@aydus_journal\`\n• \`Made with 💙 by [Ayida](https://t.me/aydus_journal)\`\n• \`Follow us: [LinkedIn](https://...) | [Telegram](https://...)\`\n\n_(Type /cancel anytime to exit)_\n\n⚠️ *Note: Make sure this bot is added as an administrator to your channel!*`,
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

  // How To Use Command
  bot.onText(/\/howto|\/help/, (msg) => {
    sendHowToGuide(msg.chat.id);
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
      case "cmd_howto":
        sendHowToGuide(chatId);
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

      // Validate signature formatting
      const validation = validateSignatureFormat(signature);
      if (!validation.isValid) {
        await bot.sendMessage(chatId, validation.errorMessage!, { parse_mode: "Markdown" });
        return; // Keep session active so user can fix their signature input
      }

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

      const { isAdmin, reason } = await isUserAdmin(channelId, userId);
      if (!isAdmin) {
        if (reason === "BOT_NOT_ADMIN") {
          await bot.sendMessage(
            chatId,
            `🤖 *Bot Administrator Rights Required*\n\n` +
            `**SignatureBot** is not an administrator in *${channelDisplay}* yet.\n\n` +
            `📌 *How to Fix:*\n` +
            `1. Open your channel *${channelDisplay}*\n` +
            `2. Go to **Settings** → **Administrators** → **Add Administrator**\n` +
            `3. Add **SignatureBot** and enable **Post Messages** permission\n` +
            `4. Try setting your signature again!`,
            { parse_mode: "Markdown" }
          );
        } else {
          await bot.sendMessage(
            chatId,
            `🚫 *Permission Denied*\n\nYou must be an **Administrator or Creator** of *${channelDisplay}* to set or manage its signature.\n\nPlease verify that your account is an admin in that channel.`,
            { parse_mode: "Markdown" }
          );
        }
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
