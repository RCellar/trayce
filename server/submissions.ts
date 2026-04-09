import { rmSync } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Submission {
  id: string;
  pngPath: string;
  prompt: string;
  timestamp: number;
}

export class SubmissionStore {
  private counter = 0;

  constructor(
    private dir: string,
    private maxBytes: number,
  ) {}

  async save(base64Image: string, prompt: string): Promise<Submission> {
    const buffer = Buffer.from(base64Image, "base64");
    if (buffer.byteLength > this.maxBytes) {
      throw new Error(
        `Submission exceeds max size: ${buffer.byteLength} bytes > ${this.maxBytes} bytes`,
      );
    }

    await mkdir(this.dir, { recursive: true, mode: 0o700 });

    const timestamp = Date.now();
    // Append counter to prevent timestamp collisions on rapid submissions
    const id = `sub-${timestamp}-${this.counter++}`;
    const pngPath = join(this.dir, `${id}.png`);

    await writeFile(pngPath, buffer, { mode: 0o600 });

    return { id, pngPath, prompt, timestamp };
  }

  async cleanup(ttlMs: number): Promise<number> {
    const now = Date.now();
    let removed = 0;

    try {
      const files = await readdir(this.dir);
      for (const file of files) {
        if (!file.endsWith(".png")) continue;
        const filePath = join(this.dir, file);
        try {
          const fileStat = await stat(filePath);
          if (now - fileStat.mtimeMs > ttlMs) {
            await unlink(filePath);
            removed++;
          }
        } catch (e: any) {
          if (e.code !== "ENOENT") throw e;
        }
      }
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }

    return removed;
  }

  removeAll(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}
