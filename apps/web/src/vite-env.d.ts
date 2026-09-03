/// <reference types="vite/client" />

// Vite types unknown keys of import.meta.env as `any`; declaring the ones we read keeps
// the strictness the project relies on at the one boundary where config enters the client.
interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
