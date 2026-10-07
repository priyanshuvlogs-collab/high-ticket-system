import { loadEnv } from "./env.js";
import { buildServices } from "./services.js";
import { buildApp } from "./app.js";

const env = loadEnv();
const svc = buildServices(env);
const app = await buildApp(svc);

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
