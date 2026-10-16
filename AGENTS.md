# AGENTS.md

drydock is a small, general-purpose plugin kernel published as TypeScript source (no build step, no `dist`). Consumers install it from GitHub and run it with Bun.

- Keep it dependency-free. Runtime code may only import from `node:` built-ins, and only in the Bun entry (`src/index.ts` and `src/source/`). Code reachable from `src/browser.ts` must not use Node or Bun APIs.
- Keep it app-agnostic. Nothing here should know about any particular application built on drydock. App-specific services and events belong in the app, declared as tokens with `service<T>(id)` and `event<F>(id)`. Runtime code identifies tokens by their `id` string, never by object identity.
- Use Bun (`bun install`, `bun add`), and commit `bun.lock`.
- Public API is whatever `src/kernel.ts`, `src/index.ts` and `src/browser.ts` export. If you change it, update `docs/concepts.md`.
- Run `bun run check` (strict `tsc`, then `bun test`) and make sure it passes before reporting work as done. Keep tests few and in `test/`.
