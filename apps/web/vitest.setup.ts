import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

import { i18n } from "./src/shared/i18n/i18n";

beforeEach(async () => {
  await i18n.changeLanguage("ru");
});

// Testing Library only auto-cleans when Vitest globals are on; this project keeps them off,
// so without this the DOM of one test leaks into the next.
afterEach(() => {
  cleanup();
});
