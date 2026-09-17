import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LoginPage } from "./LoginPage";

describe("LoginPage", () => {
  it("translates the current screen and exposes the registration fields", async () => {
    render(<LoginPage />);

    await userEvent.click(screen.getByRole("button", { name: "English" }));

    expect(screen.getByRole("heading", { name: "Sign in to Voreli" })).toBeInTheDocument();
    expect(screen.getByText("Conversations that stay", { exact: false })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Use an invitation" }));

    expect(screen.getByLabelText("Invite code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });
});
