import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EXPECTED_MIGRATION_FILES } from "../scripts/internal/neon-migration-engine.js";

test("admin operations migration records future status transitions without inventing past history", async () => {
  const sql = await readFile(new URL("../database/migrations/011_admin_operations_history.sql", import.meta.url), "utf8");
  assert.ok(EXPECTED_MIGRATION_FILES.includes("011_admin_operations_history.sql"));
  assert.match(sql, /CREATE TABLE public\.payment_status_history/);
  assert.match(sql, /AFTER UPDATE OF status ON public\.payments/);
  assert.match(sql, /OLD\.status IS DISTINCT FROM NEW\.status/);
  assert.doesNotMatch(sql.split("CREATE FUNCTION")[0], /INSERT INTO public\.payment_status_history/);
  assert.match(sql.split("CREATE FUNCTION")[1], /INSERT INTO public\.payment_status_history/);
  assert.match(sql, /CREATE TABLE public\.admin_role_change_audit/);
});
