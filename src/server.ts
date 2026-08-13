import { bot } from "./bot.ts";
import { WEBHOOK_PATH, WEBHOOK_SECRET_TOKEN, IN_DEV_MODE } from "./config.ts";

export const handler = async (req: Request): Promise<Response> => {
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

export async function setupServer(): Promise<void> {
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
    bot.on("polling_error", (error) => {
      if (error.message.includes("409 Conflict")) {
        console.warn("⚠️ 409 Conflict: Another process is polling Telegram.");
      } else {
        console.error("Polling error:", error.message);
      }
    });
  }

  Deno.serve({ port: 8000, handler });
}
