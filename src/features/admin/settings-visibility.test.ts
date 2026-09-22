import { describe, expect, it } from "vitest";
import { canViewIntegrations } from "./settings-visibility";

describe("integration settings visibility", () => {
  it("is limited to the developer account", () => {
    expect(canViewIntegrations("nickolas.gettel@tdsynnex.com")).toBe(true);
    expect(canViewIntegrations(" NICKOLAS.GETTEL@TDSYNNEX.COM ")).toBe(true);
    expect(canViewIntegrations("admin@tdsynnex.com")).toBe(false);
  });
});
