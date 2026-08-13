import TelegramBot from "telegram-bot-api";

export interface UserSession {
  action: "set" | "change" | "remove";
  step: "AWAITING_SIGNATURE" | "AWAITING_CHANNEL";
  signature?: string;
}

export interface ProcessedSignature {
  displayText: string;
  entities: TelegramBot.MessageEntity[];
}
