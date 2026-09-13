import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ServerRail } from "./ServerRail";

describe("ServerRail", () => {
  it("uses the brand as home and keeps language out of the authenticated rail", async () => {
    let homeSelected = false;

    render(
      <ServerRail
        servers={[]}
        activeServerId="s1"
        onHome={() => {
          homeSelected = true;
        }}
        onSelect={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Главная Voreli" }));

    expect(homeSelected).toBe(true);
    expect(screen.queryByRole("group", { name: "Язык" })).toBeNull();
  });
});
