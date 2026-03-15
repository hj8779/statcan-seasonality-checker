import { defineConfig } from "drizzle-kit"
import "dotenv/config"

export default defineConfig({
  // Path to the Drizzle schema file
  schema: "./packages/shared/src/db/schema.ts",

  // Directory where migration SQL files are generated
  out: "./drizzle",

  dialect: "postgresql",

  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? (() => { throw new Error("DATABASE_URL is not set") })(),
  },

  // Verbose output during migrations
  verbose: true,
  strict:  false,
})
