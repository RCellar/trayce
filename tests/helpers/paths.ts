import { tmpdir } from "node:os";
import { join } from "node:path";

export function testDir(name: string): string {
  return join(tmpdir(), `trayce-test-${name}`);
}
