import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

describe("API", () => {
  it("returns 404 for unknown endpoints", async () => {
    const app = createApp();
    const response = await request(app).get("/api/unknown-endpoint");

    expect(response.status).toBe(404);
    expect(response.body.status).toBe("fail");
  });
});
