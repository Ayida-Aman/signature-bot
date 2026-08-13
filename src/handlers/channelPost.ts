// @deno-types="npm:@types/node-telegram-bot-api"
import TelegramBot from "telegram-bot-api";
import { bot } from "../bot.ts";
import { channelSignatures } from "../db.ts";
import { combineMessageWithSignature } from "../utils/formatting.ts";

export function setupChannelPostHandler(): void {
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
      // Resend Fallback if Edit Fails
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
}
