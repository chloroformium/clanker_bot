import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { Telegraf } from "telegraf";
import OpenAI from "openai";
import sql, {saveUserMessage, saveBotResponse, getUserHistory, clearUserHistory, clearInactiveHistory} from './db.js';
import cron from "node-cron";

const port = process.env.PORT || 3000;

process.on('uncaughtException', e => console.error('uncaughtException', e));
process.on('unhandledRejection', e => console.error('unhandledRejection', e));

console.log("USING DB URL:", process.env.SUPABASE_CONNECTION_STRING);

const app = express();
app.use(express.json());

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

const CONTEXT_LIMIT = 30;
const CHARS_LIMIT = 9999;
const systemPrompt = process.env.SYSTEM_PROMPT || 'You are useful and polite AI-assistant. Please write concisely and use the language the user uses.'; 
const now = () => new Date().toISOString();

async function buildContext(userId, userMessage, imageUrl = null) {
  let rows = await getUserHistory(userId, CONTEXT_LIMIT);
rows = rows.reverse();

const messages = [{ role: 'system', content: systemPrompt }];
  let totalChars = systemPrompt.length;

  for (const row of rows) {
    if (row.text && row.text !== "[Photo]") {
      if (totalChars + row.text.length < CHARS_LIMIT) {
        messages.push({ role: 'user', content: row.text });
        totalChars += row.text.length;
      }
    }
    if (row.response && row.response !== "no answer") {
      if (totalChars + row.response.length < CHARS_LIMIT) {
        messages.push({ role: 'assistant', content: row.response });
        totalChars += row.response.length;
      }
    }
  }
  if (imageUrl) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userMessage || "What is depicted in this photo?" },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    });
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  return messages;
}

async function processAiResponse(ctx, userId, userText, imageUrl = null) {
  try {
    await saveUserMessage({ userId, text: userText || "[Photo]" });

    const messages = await buildContext(userId, userText, imageUrl);

    const completion = await openrouter.chat.completions.create({
      model: 'google/gemma-3-27b-it:free', messages, temperature: 0.5
    });

    const botReply = completion?.choices?.[0]?.message?.content || "no answer";

    await saveBotResponse({ userId, response: botReply });
    
    console.log(`[${now()}] answer sent (${ctx.from.username || userId})`);
    await ctx.reply(botReply);

  } catch (err) {
    console.error(`[${now()}] processing error, `, err);
    await ctx.reply('processing error');
  }
}

bot.start(ctx => ctx.reply("Hey! Just ask any question and I'll answer using AI model"));
bot.help(ctx => ctx.reply("Just write a message, the answer won't take too long"));

bot.command('clear', async ctx => {
  try {
    const userId = String(ctx.from.id);
    await clearUserHistory(userId);
    await ctx.reply('the context was cleared');
  } catch {
    await ctx.reply('context cleaning error');
  }
});

bot.telegram.setMyCommands([
  { command: 'start', description: 'start bot' },
  { command: 'help', description: 'help' },
  { command: 'clear', description: 'clear context' },
]);

bot.hears('clear', async ctx => {
  try {
    const userId = String(ctx.from.id);
    await clearUserHistory(userId);
    await ctx.reply('the context was cleared');
  } catch {
    await ctx.reply('context cleaning error');
  }
});

cron.schedule('0 0 * * *', async () => {
    const result = await clearInactiveHistory(5);
});

bot.on('text', async ctx => {await processAiResponse(ctx, String(ctx.from.id), ctx.message.text);
});

bot.on('photo', async ctx => {
  try {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const caption = ctx.message.caption; 
    await processAiResponse(ctx, String(ctx.from.id), caption, fileLink.href);
  } catch (err) {
    await ctx.reply("cannot read the message");
  }
});

cron.schedule('0 0 * * *', async () => {
        const deletedUserIds = await clearInactiveHistory(); 
        for (const userId of deletedUserIds) {
            try {
                await bot.telegram.sendMessage (userId, "user was inactive for 5 days, context cleared");
                await new Promise(resolve => setTimeout(resolve, 60));
            } catch (error) {
                console.error(`cannot send message to ${userId}:`, error.message);
            }
        }
});

const webhookPath = '/webhook';

app.use(bot.webhookCallback('/api/webhook'));
app.get('/', (_, res) => res.send('bot is running via webhook'));

export default app;
