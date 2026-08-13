import { loadSignatures } from "./src/db.ts";
import { setupCommandHandlers } from "./src/handlers/commands.ts";
import { setupChannelPostHandler } from "./src/handlers/channelPost.ts";
import { setupServer } from "./src/server.ts";

console.log("🚀 Initializing SignatureBot...");

// 1. Load database & migrate legacy keys
await loadSignatures();

// 2. Register event handlers
setupCommandHandlers();
setupChannelPostHandler();

// 3. Start server / polling
await setupServer();

console.log("🚀 SignatureBot is fully online!");