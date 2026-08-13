// @deno-types="npm:@types/node-telegram-bot-api"
import TelegramBot from "telegram-bot-api";
import { bot } from "../bot.ts";
import { channelSignatures } from "../db.ts";
import { combineMessageWithSignature } from "../utils/formatting.ts";

/**
 * Wraps Telegram API operations to handle HTTP 429 Too Many Requests rate limits automatically.
 */
async function withAutoRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const is429 = error?.response?.body?.error_code === 429 || error?.message?.includes("429");
    if (is429) {
      const retryAfter = error?.response?.body?.parameters?.retry_after || 1;
      console.warn(`⚠️ 429 Rate Limited by Telegram. Retrying after ${retryAfter}s...`);
      await new Promise((resolve) => setTimeout(resolve, (retryAfter + 0.5) * 1000));
      return await operation();
    }
    throw error;
  }
}

export function setupChannelPostHandler(): void {
  bot.on("channel_post", async (msg) => {
    const chatId = msg.chat.id.toString();
    const messageId = msg.message_id;

    if (msg.forward_from_chat || msg.forward_from || msg.forward_sender_name) return;

    const signature = channelSignatures[chatId];
    if (!signature) return;

    const photo = msg.photo;
    const video = msg.video;
    const document = msg.document;
    const audio = msg.audio;
    const animation = msg.animation;
    const isMedia = Boolean(photo || video || document || audio || animation);

    try {
      if (msg.text && !msg.text.includes(signature)) {
        const { text: updatedText, entities: updatedEntities } = combineMessageWithSignature(
          msg.text,
          msg.entities,
          signature
        );

        await withAutoRetry(() =>
          bot.editMessageText(updatedText, {
            chat_id: msg.chat.id,
            message_id: messageId,
            entities: updatedEntities,
            disable_web_page_preview: true,
          } as TelegramBot.EditMessageTextOptions)
        );
        console.log(`Edited text post ${messageId} in ${chatId}`);
      } else if ((msg.caption !== undefined || isMedia) && !(msg.caption && msg.caption.includes(signature))) {
        const { text: updatedCaption, entities: updatedEntities } = combineMessageWithSignature(
          msg.caption,
          msg.caption_entities,
          signature
        );

        await withAutoRetry(() =>
          bot.editMessageCaption(updatedCaption, {
            chat_id: msg.chat.id,
            message_id: messageId,
            caption_entities: updatedEntities,
          } as TelegramBot.EditMessageCaptionOptions)
        );
        console.log(`Edited caption on post ${messageId} in ${chatId}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`❌ Edit failed for post ${messageId}: ${error.message}`);
      }
      // Resend Fallback if Edit Fails
      try {
        await withAutoRetry(() => bot.deleteMessage(msg.chat.id, messageId));
        if (msg.text) {
          const { text: updatedText, entities: updatedEntities } = combineMessageWithSignature(
            msg.text,
            msg.entities,
            signature
          );
          await withAutoRetry(() =>
            bot.sendMessage(msg.chat.id, updatedText, {
              entities: updatedEntities,
              disable_web_page_preview: true,
            })
          );
        } else {
          const { text: updatedCaption, entities: updatedEntities } = combineMessageWithSignature(
            msg.caption,
            msg.caption_entities,
            signature
          );
          const opts = { caption: updatedCaption, caption_entities: updatedEntities };

          if (photo) {
            await withAutoRetry(() => bot.sendPhoto(msg.chat.id, photo.at(-1)!.file_id, opts));
          } else if (video) {
            await withAutoRetry(() => bot.sendVideo(msg.chat.id, video.file_id, opts));
          } else if (document) {
            await withAutoRetry(() => bot.sendDocument(msg.chat.id, document.file_id, opts));
          } else if (audio) {
            await withAutoRetry(() => bot.sendAudio(msg.chat.id, audio.file_id, opts));
          } else if (animation) {
            await withAutoRetry(() => bot.sendAnimation(msg.chat.id, animation.file_id, opts));
          }
        }
      } catch (fallbackError) {
        if (fallbackError instanceof Error) {
          console.error(`⚠️ Fallback resend failed: ${fallbackError.message}`);
        }
      }
    }
  });
}
