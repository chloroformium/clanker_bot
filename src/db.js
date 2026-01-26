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

export async function setUserModel(userId, modelId) {
  return sql`
    INSERT INTO users (user_id, selected_model)
    VALUES (${userId}, ${modelId})
    ON CONFLICT (user_id) 
    DO UPDATE SET selected_model = ${modelId}
    RETURNING *;
  `;
}


export async function getUserModel(userId) {
  const [user] = await sql`
    SELECT selected_model FROM users WHERE user_id = ${userId}
  `;
  return user ? user.selected_model : 'google/gemma-3-27b-it:free';
}

export async function getUserCharacter(userId) {
  const [user] = await sql`
    SELECT selected_character FROM users WHERE user_id = ${userId}
  `;
  return user ? user.selected_character : 'You are useful, honest and polite AI-assistant. Please write concisely and use the language the user uses.';
}

export async function setUserCharacter(userId, characterId) {
  return sql`
    INSERT INTO users (user_id, selected_character)
    VALUES (${userId}, ${characterId})
    ON CONFLICT (user_id) 
    DO UPDATE SET selected_model = ${modelId}
    RETURNING *;
  `;
}