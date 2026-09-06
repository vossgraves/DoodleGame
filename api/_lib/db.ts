import { neon } from "@neondatabase/serverless";

/**
 * Neon's HTTP driver: each query is a one-shot request, which is what you want
 * from short-lived serverless invocations that cannot hold a pool open.
 */
export const sql = neon(process.env.DATABASE_URL || "");

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
}
