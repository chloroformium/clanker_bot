import dotenv from "dotenv";
dotenv.config();
import { Telegraf} from "telegraf";
import OpenAI from "openai";
import sql, { saveUserMessage, saveBotResponse, getUserHistory, clearUserHistory } from './db.js';

console.log("USING DB URL:", process.env.SUPABASE_CONNECTION_STRING);


const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

const CONTEXT_LIMIT = 50;
const CHARS_LIMIT = 9999;
const systemPrompt = process.env.SYSTEM_PROMPT || 'You are useful and polite AI-assistant. Please write concisely and use the language the user uses.'; 
const now = () => new Date().toISOString();

async function buildContext(userId, userMessage) {
  const rows = await getUserHistory(userId, CONTEXT_LIMIT);

  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  let totalChars = (systemPrompt || '').length;

  for (const row of rows) {
    if (row.text) {
      const len = row.text.length;
      if (totalChars + len > CHARS_LIMIT) break;
      messages.push({ role: 'user', content: row.text });
      totalChars += len;
    }

    const botText = row.response ?? row.response;
    if (botText) {
      const len = botText.length;
      if (totalChars + len > CHARS_LIMIT) break;
      messages.push({ role: 'assistant', content: botText });
      totalChars += len;
    }
  }

  messages.push({ role: 'user', content: userMessage });

  return messages;
}

bot.start(ctx => ctx.reply("Hey! Just ask any question and I'll answer using AI model"));
bot.help(ctx => ctx.reply("Just write a message, the answer won't take too long"));

bot.command('clear', async ctx => {
  try {
    const userId = String(ctx.from.id);
    await clearUserHistory(userId);
    await ctx.reply('the context was cleared');
  } catch (err) {
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
  } catch (err) {
    await ctx.reply('context cleaning error');
  }
});

bot.on('text', async ctx => {
  try {
    const userMessage = ctx.message.text;
    const userId = String(ctx.from.id);

       await saveUserMessage({ userId, text: userMessage });

    const messages = await buildContext(userId, userMessage);

    const completion = await openrouter.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-nano-9b-v2:free',
      messages,
      temperature: 0.5
    });

    let botReply = '';
    const choice = completion?.choices?.[0];
    if (choice) {
      const content = choice.message?.content;
      if (Array.isArray(content)) {
        botReply = content.map(c => (typeof c === 'string' ? c : (c?.text || ''))).join('');
      } else if (typeof content === 'string') {
        botReply = content;
      } else if (content && typeof content === 'object') {
        botReply = content.text || '';
      }
      if (!botReply) botReply = choice.text || '';
    }

    if (!botReply) {
      await ctx.reply('An empty answer was returned');
      return;
    }

     await saveBotResponse({ userId, response: botReply });

    console.log(`[${now()}] sending the answer (${ctx.from.username || ctx.from.id})`);
    await ctx.reply(botReply);

  } catch (err) {
    console.error(`[${now()}] request processing error`, err);
    try { await ctx.reply('request processing error'); } catch (e) {}
  }
});

bot
  .launch({
    webhook: {
      domain: process.env.BOT_WEBHOOK_DOMAIN,
      port: 3000,
    },
  })
  .then(() => console.log('bot launched via webhook'))
  .catch(async (err) => {
    console.log("an error occured, tryin' to establish polling connection");

<<<<<<< HEAD
    try {
      await bot.launch();
      console.log('bot launched via polling');
    } catch (pollingErr) {
      console.error('polling lauch failed too :)', pollingErr);
    }
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
=======

app.use(bot.webhookCallback('/api/webhook'));
app.get('/', (_, res) => res.send('bot is running via webhook'));

export default app;
>>>>>>> bccfe0f (i need a beer)
