import { createMysqlPoolFromEnv, createUser, ensureAuthSchema } from "../server/mysql-auth.mjs";

const [username, displayName = username, role = "editor"] = process.argv.slice(2);
const password = process.env.SHIM_PASSWORD;

if (!username || !password) {
  console.error("Usage: SHIM_PASSWORD=<password> node scripts/create-user.mjs <username> [displayName] [admin|editor|viewer]");
  process.exit(1);
}

const pool = createMysqlPoolFromEnv(process.env);

try {
  await ensureAuthSchema(pool);
  const user = await createUser(pool, { username, displayName, password, role });
  console.log(`User ready: ${user.username} (${user.role})`);
} finally {
  await pool.end();
}
