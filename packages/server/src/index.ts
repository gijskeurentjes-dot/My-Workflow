import { config } from './config.js';
import { createApp } from './app.js';
import { createContext } from './context.js';

const ctx = createContext();
const app = createApp(ctx);

const server = app.listen(config.port, () => {
  console.log(`AI Islands API  http://localhost:${config.port}`);
  console.log(`  engine        ${config.agentEngine} (tick ${config.agentTickMs}ms)`);
  console.log(`  database      ${config.databasePath}`);
  console.log(`  stream        http://localhost:${config.port}/api/stream`);
});

/** Close streams and the database before the process goes away. */
function shutdown(signal: string): void {
  console.log(`\n${signal} received — shutting down`);
  ctx.shutdown();
  server.close(() => process.exit(0));
  // Do not hang forever on a connection that refuses to close.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
