/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the back-office API. Empty or unset means same-origin. */
  readonly VITE_API_URL?: string;
}
