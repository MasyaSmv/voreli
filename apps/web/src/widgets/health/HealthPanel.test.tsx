import { render, screen } from "@testing-library/react";
import type { HealthResponse } from "@voreli/shared";
import { describe, expect, it } from "vitest";

import { HealthPanel } from "./HealthPanel";

const health: HealthResponse = { status: "ok", uptime: 3725, version: "0.1.0" };

describe("HealthPanel", () => {
  it("renders the server answer using the shared contract type", () => {
    render(
      <HealthPanel
        serverUrl="http://localhost:3000"
        health={health}
        error={null}
        isPending={false}
      />,
    );

    expect(screen.getByTestId("health-status")).toHaveTextContent("на связи");
    expect(screen.getByTestId("health-uptime")).toHaveTextContent("01:02:05");
    expect(screen.getByTestId("health-version")).toHaveTextContent("0.1.0");
  });

  it("shows the failure instead of a stale answer when the server is unreachable", () => {
    render(
      <HealthPanel
        serverUrl="http://localhost:3000"
        health={undefined}
        error={new Error("Failed to fetch")}
        isPending={false}
      />,
    );

    expect(screen.getByTestId("health-status")).toHaveTextContent("недоступен");
    expect(screen.getByTestId("health-error")).toHaveTextContent("Failed to fetch");
    expect(screen.queryByTestId("health-version")).toBeNull();
  });
});
