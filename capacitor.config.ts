import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.formstr.pages",
  appName: "Pages by Form*",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
