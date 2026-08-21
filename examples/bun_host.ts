import { Context, token } from "@drydock/core";
import { LOGGER, createLogger, type LogRecord } from "@drydock/logger";
import { Loader } from "@drydock/loader";
import { bunResolver } from "@drydock/bun";

const records: LogRecord[] = [];
const output = token<string>("output");
const context = Context.create();
context.provide(LOGGER, createLogger((record) => records.push(record)));

const loader = new Loader(context, bunResolver({ from: import.meta.url }));
await loader.load([{
  id: "host-plugin",
  use: "./host_plugin.ts",
  config: { output, name: "drydock" },
}]);

const value = context.use(output);
await context.dispose();

console.log(JSON.stringify({
  value,
  messages: records.map((record) => record.message),
}));
