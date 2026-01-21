import postgres from 'postgres';
import dotenv from "dotenv";
dotenv.config();

const sql = postgres( process.env.SUPABASE_CONNECTION_STRING );

export default sql;

console.log("SUPABASE_CSTRING =", process.env.SUPABASE_CONNECTION_STRING);

export async function saveUserMessage({ userId, text }) {
  return sql`
    INSERT INTO messages (user_id, text)
    VALUES (${userId}, ${text})
    RETURNING *
  `;
}

export async function saveBotResponse({ userId, response }) {
  return sql`
    INSERT INTO messages (user_id, response)
    VALUES (${userId}, ${response})
    RETURNING *
  `;
}

export async function getUserHistory(userId, limit = 50) {
  return sql`
    SELECT *
    FROM messages
    WHERE user_id = ${userId}
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
}

export async function clearUserHistory(userId) {
  return sql`DELETE FROM messages WHERE user_id = ${userId};`;
}

export async function clearInactiveHistory() {
  const deletedRows = await sql`
    DELETE FROM messages 
    WHERE created_at < NOW() - INTERVAL '5 days'
    RETURNING user_id;
  `;
  return [...new Set(deletedRows.map(row => row.user_id))];
}

