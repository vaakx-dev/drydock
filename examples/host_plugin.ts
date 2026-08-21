import { definePlugin, type Token } from "@drydock/core";
import { LOGGER } from "@drydock/logger";
import { sleep } from "@drydock/timer";

interface Config {
  readonly output: Token<string>;
  readonly name: string;
}

export default definePlugin<Config>({
  name: "host-plugin",
  requires: [LOGGER],
  async setup(context, config) {
    const logger = context.use(LOGGER).child({ plugin: "host-plugin" });
    logger.info("starting");
    await sleep(context, 1);
    context.provide(config.output, `hello ${config.name}`);
    return () => logger.info("stopped");
  },
});
