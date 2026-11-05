// Binding types derived from wrangler.local.jsonc. Keep runtime types scoped:
// global workerd declarations conflict with the browser DOM types used by React.
declare module "cloudflare:workers" {
  export const env: { DB: import("@cloudflare/workers-types").D1Database };
}
