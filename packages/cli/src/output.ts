import { writeSync } from 'node:fs';

export type Output = {
  out: (line: string) => Promise<void>;
  err: (line: string) => Promise<void>;
};

function writeAll(fd: number, text: string): void {
  const bytes = Buffer.from(text);
  let offset = 0;
  while (offset < bytes.length) {
    try {
      offset += writeSync(fd, bytes, offset, bytes.length - offset);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'EPIPE') return;
      if (code === 'EAGAIN') {
        Bun.sleepSync(1);
        continue;
      }
      throw error;
    }
  }
}

export const streamOutput: Output = {
  out: async (line) => {
    writeAll(1, `${line}\n`);
  },
  err: async (line) => {
    writeAll(2, `${line}\n`);
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
