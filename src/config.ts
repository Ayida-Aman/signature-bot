try {
  const { load } = await import("https://deno.land/std@0.224.0/dotenv/mod.ts");
  const env = await load({ export: true });
  console.log("Loaded .env variables:", Object.keys(env));
} catch {
  // .env may not exist in production environments
}

export const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
export const WEBHOOK_SECRET_TOKEN = Deno.env.get("WEBHOOK_SECRET_TOKEN");

// Automatically detect Deno Deploy cloud environment via built-in DENO_DEPLOYMENT_ID or APP_ENV
export const IS_DENO_DEPLOY = Boolean(Deno.env.get("DENO_DEPLOYMENT_ID"));
export const APP_ENV = Deno.env.get("APP_ENV") || (IS_DENO_DEPLOY ? "production" : "development");
export const IN_DEV_MODE = !IS_DENO_DEPLOY && APP_ENV === "development";

console.log("TELEGRAM_BOT_TOKEN:", TELEGRAM_BOT_TOKEN ? "✅ Loaded" : "❌ Missing");
console.log("WEBHOOK_SECRET_TOKEN:", WEBHOOK_SECRET_TOKEN ? "✅ Loaded" : "❌ Missing");
console.log(`Environment Mode: 🚀 ${APP_ENV} (Deno Deploy Cloud: ${IS_DENO_DEPLOY ? "Yes" : "No"})`);

if (!TELEGRAM_BOT_TOKEN || !WEBHOOK_SECRET_TOKEN) {
  throw new Error("Missing required environment variables TELEGRAM_BOT_TOKEN or WEBHOOK_SECRET_TOKEN");
}

export const WEBHOOK_PATH = `/${WEBHOOK_SECRET_TOKEN}`;
