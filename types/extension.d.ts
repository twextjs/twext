/** Argument values passed to a block handler, keyed by the argument names declared in twext.yml. */
export type HandlerArgs = Record<string, unknown>;

/** The `util` object passed to every block handler. See the TurboWarp docs for its full API. */
export type Util = Record<string, unknown>;

/** A block handler. Receives the block's argument values and the util object. */
export type Handler<A extends HandlerArgs = HandlerArgs> = (args: A, util: Util) => unknown;

/** A map of opcode -> handler. Your entryPoint exports this as `blocks`. */
export type Blocks = Record<string, Handler<any>>;

/** Code run once when the extension loads. Also accepts raw source strings. */
export type Setup = (() => void) | string | string[];

/** A shared helper published on the extension class. */
export type Method = (this: unknown, ...args: any[]) => unknown;

/** A map of method name -> function. Your entryPoint exports this as `methods`. */
export type Methods = Record<string, Method>;

/** The shape twext expects an entryPoint module to have. */
export interface Extension {
  blocks: Blocks;
  setup?: Setup;
  methods?: Methods;
}
