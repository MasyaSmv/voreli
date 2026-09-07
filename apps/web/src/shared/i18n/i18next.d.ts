import "i18next";

import type { ru } from "./lang/ru";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    returnNull: false;
    resources: {
      translation: typeof ru;
    };
  }
}
