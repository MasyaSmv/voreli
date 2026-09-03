import "reflect-metadata";

import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { HEALTH_ROUTE, isHealthResponse } from "@voreli/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";

describe("GET /health", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers 200 with a payload matching the shared contract", async () => {
    const response = await request(app.getHttpServer()).get(HEALTH_ROUTE).expect(200);

    expect(isHealthResponse(response.body)).toBe(true);
  });

  it("reports the version of the running build", async () => {
    const response = await request(app.getHttpServer()).get(HEALTH_ROUTE).expect(200);

    expect(response.body).toMatchObject({ status: "ok", version: "0.1.0" });
    expect(response.body.uptime).toBeGreaterThan(0);
  });
});
