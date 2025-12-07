require('dotenv').config();
const { Telegraf } = require('telegraf');
const { OpenAI } = require('openai');

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

const now = () => new Date().toISOString();

bot.start(ctx => ctx.reply("Hey! Just ask any question and I'll answer using AI model"));
bot.help(ctx => ctx.reply("Just write a message, the answer won't take too long"));

bot.on('text', async ctx => {
  try {
    const userMessage = ctx.message.text;

    const systemPrompt = process.env.SYSTEM_PROMPT ||
      'You are useful and polite AI-assistant. Please write concisely and use the language the user uses.';

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    const completion = await openrouter.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-nano-9b-v2:free',
      messages,
      temperature: 0.1
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
      console.warn('Empty reply from OpenAI response:', JSON.stringify(completion, null, 2));
      await ctx.reply('An empty answer was returned');
      return;
    }

    console.log(`[${now()}] sending the answer (${ctx.from.username || ctx.from.id})`);
    await ctx.reply(botReply);
  } catch (err) {
    console.error(`[${now()}] request processing error`, err);
    try { await ctx.reply('request processing error'); } catch (e) {}
  }
});

bot.launch()
  .then(() => console.log('Bot launched'))
  .catch(console.error);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
