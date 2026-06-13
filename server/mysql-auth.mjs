import mysql from "mysql2/promise";
import { hashPassword, hashSessionToken, verifyPassword } from "./auth-crypto.mjs";

const VALID_ROLES = new Set(["admin", "editor", "viewer"]);

export function createMysqlPoolFromEnv(env = process.env) {
  if (env.DATABASE_URL) {
    return mysql.createPool({
      uri: env.DATABASE_URL,
      timezone: "Z",
      waitForConnections: true,
      connectionLimit: Number(env.MYSQL_CONNECTION_LIMIT || 10)
    });
  }

  const missing = ["MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"].filter(key => !env[key]);
  if (missing.length) {
    throw new Error(`Missing MySQL environment variables: ${missing.join(", ")}`);
  }

  return mysql.createPool({
    host: env.MYSQL_HOST || "127.0.0.1",
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    charset: "utf8mb4",
    timezone: "Z",
    waitForConnections: true,
    connectionLimit: Number(env.MYSQL_CONNECTION_LIMIT || 10)
  });
}

export async function ensureAuthSchema(pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(80) NOT NULL,
      display_name VARCHAR(80) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'editor',
      disabled_at DATETIME(3) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY users_username_unique (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash CHAR(43) NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME(3) NULL,
      user_agent VARCHAR(255) NULL,
      ip_address VARCHAR(45) NULL,
      PRIMARY KEY (token_hash),
      KEY sessions_user_id_index (user_id),
      KEY sessions_expires_at_index (expires_at),
      CONSTRAINT sessions_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function createAuthStore(env = process.env) {
  const pool = createMysqlPoolFromEnv(env);
  await ensureAuthSchema(pool);
  return {
    pool,
    createUser: user => createUser(pool, user),
    verifyCredentials: (username, password) => verifyCredentials(pool, username, password),
    createSession: (userId, token, options) => createSession(pool, userId, token, options),
    getSessionUser: token => getSessionUser(pool, token),
    deleteSession: token => deleteSession(pool, token),
    deleteExpiredSessions: () => deleteExpiredSessions(pool)
  };
}

export async function createUser(pool, { username, displayName, password, role = "editor" }) {
  const normalizedUsername = String(username || "").trim();
  const normalizedDisplayName = String(displayName || normalizedUsername).trim();
  const normalizedRole = String(role || "editor").trim();

  if (!normalizedUsername) throw new Error("Username is required.");
  if (!normalizedDisplayName) throw new Error("Display name is required.");
  if (!VALID_ROLES.has(normalizedRole)) throw new Error("Role must be admin, editor, or viewer.");

  const passwordHash = hashPassword(password);
  await pool.execute(
    `
      INSERT INTO users (username, display_name, password_hash, role)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        display_name = VALUES(display_name),
        password_hash = VALUES(password_hash),
        role = VALUES(role),
        disabled_at = NULL
    `,
    [normalizedUsername, normalizedDisplayName, passwordHash, normalizedRole]
  );

  return findUserByUsername(pool, normalizedUsername);
}

export async function verifyCredentials(pool, username, password) {
  const user = await findUserByUsername(pool, username);
  if (!user || user.disabledAt) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return publicUser(user);
}

export async function createSession(pool, userId, token, options = {}) {
  const maxAgeMs = Number(options.maxAgeMs || 1000 * 60 * 60 * 24 * 14);
  const expiresAt = new Date(Date.now() + maxAgeMs);
  await pool.execute(
    `
      INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip_address)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      hashSessionToken(token),
      userId,
      expiresAt,
      truncate(options.userAgent, 255),
      truncate(options.ipAddress, 45)
    ]
  );
  return expiresAt;
}

export async function getSessionUser(pool, token) {
  if (!token) return null;
  const [rows] = await pool.execute(
    `
      SELECT
        u.id,
        u.username,
        u.display_name AS displayName,
        u.password_hash AS passwordHash,
        u.role,
        u.disabled_at AS disabledAt
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.expires_at > UTC_TIMESTAMP(3)
        AND u.disabled_at IS NULL
      LIMIT 1
    `,
    [hashSessionToken(token)]
  );

  if (!rows.length) return null;
  await pool.execute(
    "UPDATE sessions SET last_seen_at = UTC_TIMESTAMP(3) WHERE token_hash = ?",
    [hashSessionToken(token)]
  );
  return publicUser(rows[0]);
}

export async function deleteSession(pool, token) {
  if (!token) return;
  await pool.execute("DELETE FROM sessions WHERE token_hash = ?", [hashSessionToken(token)]);
}

export async function deleteExpiredSessions(pool) {
  await pool.execute("DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP(3)");
}

async function findUserByUsername(pool, username) {
  const [rows] = await pool.execute(
    `
      SELECT
        id,
        username,
        display_name AS displayName,
        password_hash AS passwordHash,
        role,
        disabled_at AS disabledAt
      FROM users
      WHERE username = ?
      LIMIT 1
    `,
    [String(username || "").trim()]
  );
  return rows[0] || null;
}

function publicUser(user) {
  return {
    id: Number(user.id),
    username: user.username,
    displayName: user.displayName,
    role: user.role
  };
}

function truncate(value, maxLength) {
  const text = value == null ? "" : String(value);
  return text.slice(0, maxLength);
}
