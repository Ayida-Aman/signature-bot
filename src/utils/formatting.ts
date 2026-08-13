import TelegramBot from "telegram-bot-api";
import { ProcessedSignature } from "../types.ts";

export interface SignatureValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

/**
 * Escapes Telegram Markdown V1 special characters (*, _, `, \) in dynamic text strings.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[_*`\\]/g, "\\$&");
}

/**
 * Validates signature input format, enforcing strict Markdown hyperlink syntax [text](url).
 */
export function validateSignatureFormat(signature: string): SignatureValidationResult {
  const hasBrackets = /\[|\]/.test(signature);

  if (hasBrackets) {
    const { entities } = processSignatureLinks(signature);
    const validLinkCount = entities.filter((e) => e.type === "text_link").length;

    // Check for malformed patterns:
    // 1. Space or newline between ] and ( e.g. [text] (url) or [text]\n(url)
    const hasSpaceOrNewlineBetween = /\[[^\]]+\]\s+\(/s.test(signature);

    // 2. [text] without (http...) or invalid URL format
    const malformedPattern = /\[[^\]]*\](?!\(https?:\/\/[^\s)]+\))/i;

    if (validLinkCount === 0 || hasSpaceOrNewlineBetween || malformedPattern.test(signature)) {
      return {
        isValid: false,
        errorMessage:
          `❌ *Invalid Hyperlink Format*\n\n` +
          `Hyperlinks must follow strict Markdown format with **no spaces or newlines** between \`]\` and \`(\`:\n` +
          `\`[Link Text](https://your-url.com)\`\n\n` +
          `💡 *Correct Example:*\n` +
          `\`Hi us [LinkedIn](https://www.linkedin.com/in/bintaman/) || [Telegram](https://t.me/aydus_gallery)\`\n\n` +
          `⚠️ *Common Mistakes:*\n` +
          `• \`[linkedin] (https://...)\` ← *(Do not put spaces between ] and ())* \n` +
          `• \`[linkedin]\n(https://...)\` ← *(Do not put newlines between ] and ())* \n` +
          `• \`[linkedin](www.linkedin.com)\` ← *(URL must start with https:// or http://)*\n\n` +
          `_Please send your signature again with the correct format (or type /cancel to exit)._`,
      };
    }
  }

  return { isValid: true };
}

/**
 * Parses Markdown links [text](url) and formatting (**bold**, *bold*, _italic_, `code`) in signatures.
 * Requires strict [text](url) format without spaces or newlines between ] and (.
 */
export function processSignatureLinks(signature: string): ProcessedSignature {
  const tokenRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|`([^`]+)`/g;

  let displayText = "";
  let lastIndex = 0;
  const entities: TelegramBot.MessageEntity[] = [];

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(signature)) !== null) {
    displayText += signature.slice(lastIndex, match.index);

    if (match[1] !== undefined && match[2] !== undefined) {
      // Hyperlink: [text](url)
      const linkText = match[1];
      const url = match[2];
      entities.push({
        type: "text_link",
        offset: displayText.length,
        length: linkText.length,
        url,
      });
      displayText += linkText;
    } else if (match[3] !== undefined || match[4] !== undefined) {
      // Bold: **text** or *text*
      const boldText = match[3] ?? match[4]!;
      entities.push({
        type: "bold",
        offset: displayText.length,
        length: boldText.length,
      });
      displayText += boldText;
    } else if (match[5] !== undefined) {
      // Italic: _text_
      const italicText = match[5];
      entities.push({
        type: "italic",
        offset: displayText.length,
        length: italicText.length,
      });
      displayText += italicText;
    } else if (match[6] !== undefined) {
      // Code: `code`
      const codeText = match[6];
      entities.push({
        type: "code",
        offset: displayText.length,
        length: codeText.length,
      });
      displayText += codeText;
    }

    lastIndex = tokenRegex.lastIndex;
  }

  displayText += signature.slice(lastIndex);

  return { displayText, entities };
}

/**
 * Combines original text/caption with a processed signature and merges entity offsets.
 */
export function combineMessageWithSignature(
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
