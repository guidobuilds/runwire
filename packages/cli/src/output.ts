export type Output = {
  out: (line: string) => Promise<void>;
  err: (line: string) => Promise<void>;
};

export const streamOutput: Output = {
  out: async (line) => {
    await Bun.write(Bun.stdout, `${line}\n`);
  },
  err: async (line) => {
    await Bun.write(Bun.stderr, `${line}\n`);
  },
};

export const consoleOutput: Output = {
  out: async (line) => {
    console.log(line);
  },
  err: async (line) => {
    console.error(line);
  },
};
