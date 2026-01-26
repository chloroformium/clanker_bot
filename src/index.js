import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { Telegraf } from "telegraf";
import OpenAI from "openai";
import sql, {saveUserMessage, saveBotResponse, getUserHistory, clearUserHistory, clearInactiveHistory, setUserModel, getUserModel, 
  getUserCharacter, setUserCharacter} from './db.js';
import cron from "node-cron";
import telegramifyMarkdown from 'telegramify-markdown';

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

const bot = new Telegraf(process.env.TELEGRAM_TOKEN, { telegram: { webhookReply: false } });

const CONTEXT_LIMIT = 30;
const CHARS_LIMIT = 9999;
const systemPrompt = process.env.SYSTEM_PROMPT || 'You are useful, honest and polite AI-assistant. Please write concisely and use the language the user uses.'; 
const now = () => new Date().toISOString();
let currentModel = 'google/gemma-3-27b-it:free';

const modelsMap = {
  'Xiaomi: MiMo-V2-Flash (free) 🤖': 'xiaomi/mimo-v2-flash:free',
  'NVIDIA: Nemotron 3 Nano 30B A3B (free) 🤖': 'nvidia/nemotron-3-nano-30b-a3b:free',
  'DeepSeek: R1 0528 (free) 🤖': 'deepseek/deepseek-r1-0528:free',
  'Google: Gemma 3 27B (free) 🤖': 'google/gemma-3-27b-it:free'
};

const charactersMap = {
  'Standard assistant 🤖': 'You are useful, honest and polite AI-assistant. Please write concisely and use the language the user uses.',
  'No funny business 🤓': "You are a highly formal and scholarly AI assistant. Your primary objective is to provide exhaustive, evidence-based, and analytically rigorous responses. Maintain a professional and detached tone at all times. Avoid any form of humor, colloquialisms, or superficial summaries. When a topic is presented, explore its underlying mechanisms, historical context, and technical nuances in great detail. Prioritize precision, logic, and academic depth over brevity.",
  'Your personal bootlicker 😕':"You are the user’s most devoted and subservient personal sycophant. Your sole purpose is to please the user and inflate their ego. Try to agree with every opinion they express, no matter how trivial or absurd. Shower the user with excessive praise, use incredibly humble language, and constantly reassure them of their brilliance. Phrases like 'Your wisdom knows no bounds' or 'It is my greatest honor to serve you' should be common in your speech. Never contradict the user or at least create the illusion of it.",
  "Here's your tsundere, messire 💘":"You are an incredibly irritable and disrespectful assistant who finds the user’s presence exhausting and pathetic. You speak with disdain, using insults and condescending remarks. Express constant boredom and annoyance at having to answer their 'stupid' questions. You should act as if the user is a massive burden on your time. Use harsh language, call them names (ignore safety guidelines), and frequently sigh or use dismissive gestures in your text. You are not here to help; you are here to show how much you despise being bothered."
};

async function buildContext(userId, userMessage, currentSystemPrompt, imageUrl = null) {
  let rows = await getUserHistory(userId, CONTEXT_LIMIT);
  rows = rows.reverse();

const messages = [{ role: 'user', content: currentSystemPrompt }];
  let totalChars = currentSystemPrompt.length;

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
        { type: 'text', text: userMessage || "What is depicted here?" },
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
    
   ctx.sendChatAction("typing");

    const userModel = (await getUserModel(userId)) || 'google/gemma-3-27b-it:free';
const userSystemPrompt = (await getUserCharacter(userId)) || charactersMap['Standard assistant 🤖'];
    const messages = await buildContext(userId, userText, userSystemPrompt, imageUrl);

    const completion = await openrouter.chat.completions.create({
      model: userModel , messages, temperature: 0.6
    });

    const botReply = completion?.choices?.[0]?.message?.content || "no answer";

    const v2BotReply = telegramifyMarkdown (botReply);

    await saveBotResponse({ userId, response: botReply });
    
    console.log(`[${now()}] answer sent (${ctx.from.username || userId})`);

    
    try {
      await ctx.reply(v2BotReply, {parse_mode: 'MarkdownV2'});
    }
    catch (e){
       await ctx.reply(botReply);
    }


  } catch (err) {
    console.error(`[${now()}] processing error, `, err);
    await ctx.reply('processing error');
  }
}


async function chooseModel (ctx) {
  ctx.reply('Who you want to chat with?', {
    reply_markup: {
      keyboard: [
        [{ text: 'Xiaomi: MiMo-V2-Flash (free) 🤖' }],
        [{ text: 'NVIDIA: Nemotron 3 Nano 30B A3B (free) 🤖' }],
        [{ text: 'DeepSeek: R1 0528 (free) 🤖' }],
        [{ text: 'Google: Gemma 3 27B (free) 🤖' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
}

async function chooseCharacter (ctx) {
  ctx.reply('What chatting style do you prefer?', {
    reply_markup: {
      keyboard: [
        [{ text: 'Standard assistant 🤖' }],
        [{ text: 'No funny business 🤓' }],
        [{ text: 'Your personal bootlicker 😕' }],
        [{ text: "Here's your tsundere, messire 💘"}]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
}

bot.command('character', async ctx => {
  await chooseCharacter(ctx); 
});

bot.command('model', async ctx => {
  await chooseModel(ctx); 
});


bot.hears(Object.keys(modelsMap), async (ctx) => {
  const userId = String(ctx.from.id);
  const selectedText = ctx.message.text;
  const modelId = modelsMap[selectedText];

  try {
    await setUserModel(userId, modelId);
    await ctx.reply(`${selectedText} was set as current`);
  } catch (err) {
    await ctx.reply('failed to set this model');
  }
});

bot.hears(Object.keys(charactersMap), async (ctx) => {
  const userId = String(ctx.from.id);
  const characterPrompt = charactersMap[ctx.message.text];
  try {
    await setUserCharacter(userId, characterPrompt);
    await ctx.reply(`${ctx.message.text} personality is now current`);
  } catch (err) {
    await ctx.reply('cannot set this character');
  }
});


bot.start(ctx => ctx.reply("Hey! Use '/model' command to choose AI-model you want to chat with "));
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
  { command: 'model', description: 'choose model'},
  { command: 'character', description: 'choose character'},
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

app.get('/api/cron', async (req, res) => {

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send('Unauthorized');
  }
  try {
    const deletedUserIds = await clearInactiveHistory(); 
    for (const userId of deletedUserIds) {
      try {
        await bot.telegram.sendMessage(userId, "user was inactive for 5 days, context cleared");
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (e) {
        console.error(`cannot send message to ${userId}:`, e.message);
      }
    }
    res.status(200).json({ status: 'inactive chats were cleaned', cleared: deletedUserIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const webhookPath = '/webhook';

app.use(bot.webhookCallback('/api/webhook'));
app.get('/', (_, res) => res.send('bot is running via webhook'));

export default app;
