import { createInterface } from "node:readline";

export function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      const chunks = [];
      stdin.on("data", (chunk) => chunks.push(chunk));
      stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").trimEnd()));
      return;
    }
    if (hidden) {
      let value = "";
      stdout.write(question);
      stdin.setEncoding("utf8");
      stdin.setRawMode(true);
      stdin.resume();
      const onData = (chunk) => {
        for (const char of chunk) {
          if (char === "\u0003") {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener("data", onData);
            stdout.write("\n");
            process.exit(130);
          }
          if (char === "\r" || char === "\n") {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener("data", onData);
            stdout.write("\n");
            return resolve(value);
          }
          if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
          else value += char;
        }
      };
      stdin.on("data", onData);
      return;
    }
    const readline = createInterface({ input: stdin, output: stdout });
    readline.question(question, (answer) => {
      readline.close();
      resolve(answer);
    });
  });
}
