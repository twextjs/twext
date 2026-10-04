import { doLogWork } from "./blocks/messaging.js";
import { square, shout } from "./blocks/more.js";

export const blocks = {
  logMessage: doLogWork,
  square,
  shout,
};

export const setup = `
  const prefix = "[Super Utilities]:";
`;
