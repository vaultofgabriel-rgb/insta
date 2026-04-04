import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

function pickEnv(
  fileEnv: Record<string, string>,
  keys: string[],
): string {
  for (const k of keys) {
    const v = (fileEnv[k] ?? process.env[k])?.trim();
    if (v) return v;
  }
  return "";
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const siteUrl = (env.VITE_SITE_URL || "https://insta-beta-liart.vercel.app").replace(/\/+$/, "");
  const ogImage = `${siteUrl}/og-share.png`;

  /** Replit bloqueia secrets com prefixo SUPABASE_. Use SB_PROJECT_URL + SB_ANON_KEY. */
  const supabaseUrl = pickEnv(env, [
    "VITE_SUPABASE_URL",
    "SB_PROJECT_URL",
    "PUBLIC_SUPABASE_URL",
  ])
    .replace(/^["']|["']$/g, "")
    .replace(/\/+$/, "");
  const supabasePublishableKey = pickEnv(env, [
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SB_ANON_KEY",
    "PUBLIC_SUPABASE_ANON_KEY",
  ]).replace(/^["']|["']$/g, "");

  return {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabasePublishableKey),
    },
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      {
        name: "html-og-url",
        transformIndexHtml(html) {
          return html.replaceAll("%OG_IMAGE%", ogImage).replaceAll("%OG_URL%", `${siteUrl}/`);
        },
      },
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
