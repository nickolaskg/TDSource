import { describe, expect, it } from "vitest";
import { integrationStatus } from "./integration-status.js";

const configured = {
  WEBEX_CLIENT_ID: "client",
  WEBEX_CLIENT_SECRET: "secret",
  WEBEX_REDIRECT_URI: "http://localhost/callback",
  SESSION_ENCRYPTION_KEY: "session-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "supabase-secret",
};

describe("integrationStatus", () => {
  it("requires both Supabase URL and a server-side key", () => {
    expect(integrationStatus(configured).supabaseConfigured).toBe(true);
    expect(integrationStatus({ ...configured, SUPABASE_SECRET_KEY: "" }).supabaseConfigured).toBe(false);
    expect(integrationStatus({ ...configured, SUPABASE_URL: "" }).supabaseConfigured).toBe(false);
  });

  it("accepts the legacy service-role key during migration", () => {
    expect(integrationStatus({ ...configured, SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "legacy-key" }).supabaseConfigured).toBe(true);
  });
});
