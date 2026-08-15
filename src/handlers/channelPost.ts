// @deno-types="npm:@types/node-telegram-bot-api"
import TelegramBot from "telegram-bot-api";
import { bot } from "../bot.ts";
import { channelSignatures } from "../db.ts";
import { combineMessageWithSignature } from "../utils/formatting.ts";
import { withAutoRetry } from "../utils/telegramHelpers.ts";

// Tracks processed media_group_ids (albums) to avoid duplicate caption edits & race conditions
const processedMediaGroups = new Map<string, number>();

function cleanupOldMediaGroups() {
  const now = Date.now();
  const FIVE_MINUTES = 5 * 60 * 1000;
  for (const [id, timestamp] of processedMediaGroups) {
    if (now - timestamp > FIVE_MINUTES) {
      processedMediaGroups.delete(id);
    }
  }
}

export function setupChannelPostHandler(): void {
  bot.on("channel_post", async (msg) => {
    const chatId = msg.chat.id.toString();
    const messageId = msg.message_id;

    if (msg.forward_from_chat || msg.forward_from || msg.forward_sender_name) return;

    const signature = channelSignatures[chatId];
    if (!signature) return;

    cleanupOldMediaGroups();

    const mediaGroupId = msg.media_group_id;
    const photo = msg.photo;
    const video = msg.video;
    const document = msg.document;
    const audio = msg.audio;
    const animation = msg.animation;
    const isMedia = Boolean(photo || video || document || audio || animation);

    // ==================== 1. MEDIA GROUP (ALBUM) HANDLING ====================
    if (mediaGroupId) {
      // If this album has already had its signature appended, skip sibling messages
      if (processedMediaGroups.has(mediaGroupId)) {
        return;
      }

      if (msg.caption !== undefined) {
        // This is the item in the album that holds the user's caption
        if (msg.caption.includes(signature)) return;

        processedMediaGroups.set(mediaGroupId, Date.now());

        const { text: updatedCaption, entities: updatedEntities } = combineMessageWithSignature(
          msg.caption,
          msg.caption_entities,
          signature
        );

        try {
          await withAutoRetry(() =>
            bot.editMessageCaption(updatedCaption, {
              chat_id: msg.chat.id,
              message_id: messageId,
              caption_entities: updatedEntities,
            } as TelegramBot.EditMessageCaptionOptions)
          );
          console.log(`Edited album caption for media group ${mediaGroupId} on post ${messageId} in ${chatId}`);
        } catch (error) {
          if (error instanceof Error) {
            console.warn(`⚠️ Could not edit album caption on post ${messageId}: ${error.message}`);
          }
        }
        return;
      }

      // If this item has no caption, wait briefly (350ms) to allow a captioned sibling item to be handled first
      await new Promise((resolve) => setTimeout(resolve, 350));

      // If a captioned item in this album was already processed during the wait, skip this item
      if (processedMediaGroups.has(mediaGroupId)) {
        return;
      }

      // If none of the items had a caption, add signature as caption to this first item
      processedMediaGroups.set(mediaGroupId, Date.now());

      const { text: updatedCaption, entities: updatedEntities } = combineMessageWithSignature(
        undefined,
        undefined,
        signature
      );

      try {
        await withAutoRetry(() =>
          bot.editMessageCaption(updatedCaption, {
            chat_id: msg.chat.id,
            message_id: messageId,
            caption_entities: updatedEntities,
          } as TelegramBot.EditMessageCaptionOptions)
        );
        console.log(`Added signature caption to album ${mediaGroupId} on post ${messageId} in ${chatId}`);
      } catch (error) {
        if (error instanceof Error) {
          console.warn(`⚠️ Could not add signature to album ${mediaGroupId} on post ${messageId}: ${error.message}`);
        }
      }
      return;
    }

    // ==================== 2. STANDALONE SINGLE POST HANDLING ====================
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
        console.log(`Edited caption on single media post ${messageId} in ${chatId}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`❌ Edit failed for post ${messageId}: ${error.message}`);
      }
      // Resend Fallback for Standalone Single Posts
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
