import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

describe("纯函数层边界", () => {
  it("check-purity 脚本以退出码 0 通过", () => {
    const out = execFileSync("node", ["scripts/check-purity.mjs"], {
      encoding: "utf8",
    });
    expect(out).toContain("边界校验通过");
  });
});
