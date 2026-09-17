import { neon } from "@neondatabase/serverless";

export const sql = neon(process.env.DATABASE_URL || "");

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
}
