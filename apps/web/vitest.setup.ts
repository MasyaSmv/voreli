import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-cleans when Vitest globals are on; this project keeps them off,
// so without this the DOM of one test leaks into the next.
afterEach(() => {
  cleanup();
});
