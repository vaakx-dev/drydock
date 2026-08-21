export class ReloadUnsupportedError extends Error {
  constructor() {
    super("plugin resolver does not support reload");
    this.name = "ReloadUnsupportedError";
  }
}
