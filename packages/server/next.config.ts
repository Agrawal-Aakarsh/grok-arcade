import type { NextConfig } from "next";

const config: NextConfig = {
  // The engine and day math are shared with the CLI as TypeScript source.
  transpilePackages: ["@x-arcade/shared"],
};

export default config;
