/**
 * @file Telegram бот для управления временными окнами code review
 * @description Позволяет устанавливать одно или два временных окна для PR и отправляет напоминания
 * @module PRReminderBot
 */

import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Экземпляр бота Telegram
 * @type {Telegraf}
 */
const bot = new Telegraf(process.env.BOT_TOKEN);

/**
 * Опциональный дефолтный чат для оповещений (например, общий канал/группа)
 * @type {number|string|undefined}
 */
const DEFAULT_TARGET_CHAT_ID = process.env.TARGET_CHAT_ID || undefined;

/**
 * Валидация формата окна HH:MM-HH:MM
 * @param {string} timeStr
 * @returns {boolean}
 */
const isValidTimeWindow = (timeStr) =>
  /^([01]?\d|2[0-3]):[0-5]\d-([01]?\d|2[0-3]):[0-5]\d$/.test(timeStr);

/**
 * @typedef {Object} Windows
 * @property {string|null} morning - Утреннее окно (HH:MM-HH:MM)
 * @property {string|null} evening - Вечернее окно (HH:MM-HH:MM)
 */

/**
 * @typedef {Object} ChatState
 * @property {Windows} windows
 * @property {Map<'morning'|'evening', NodeJS.Timeout>} reminders
 */

/**
 * Состояние по каждому чату
 * @type {Map<number|string, ChatState>}
 */
const chatStates = new Map();

/**
 * Получить/создать состояние чата
 * @param {number|string} chatId
 * @returns {ChatState}
 */
function getChatState(chatId) {
  if (!chatStates.has(chatId)) {
    chatStates.set(chatId, {
      windows: { morning: null, evening: null },
      reminders: new Map(),
    });
  }
  return chatStates.get(chatId);
}

/**
 * Отправляет сообщение в конкретный чат
 * @param {string} message
 * @param {number|string} chatId
 * @returns {Promise<void>}
 */
async function sendToChat(message, chatId) {
  try {
    await bot.telegram.sendMessage(chatId, message);
  } catch (err) {
    console.error('Ошибка отправки:', err);
  }
}

/**
 * Очистить все напоминания чата
 * @param {number|string} chatId
 */
function clearChatReminders(chatId) {
  const st = getChatState(chatId);
  for (const timeout of st.reminders.values()) clearTimeout(timeout);
  st.reminders.clear();
}

/**
 * Посчитать время «за 10 минут до начала» относительно локального времени сервера
 * @param {string} startHHMM - "HH:MM"
 * @returns {Date} ближайшее время для напоминания (сегодня/завтра)
 */
function nextReminderDate(startHHMM) {
  const [h, m] = startHHMM.split(':').map(Number);
  const now = new Date();

  const reminder = new Date();
  reminder.setSeconds(0, 0);
  reminder.setHours(h, m, 0, 0);
  // за 10 минут
  reminder.setMinutes(reminder.getMinutes() - 10);

  if (reminder <= now) {
    // на завтра
    reminder.setDate(reminder.getDate() + 1);
  }
  return reminder;
}

/**
 * Поставить напоминание для конкретного окна чата
 * @param {number|string} chatId
 * @param {'morning'|'evening'} windowKey
 * @param {string} timeWindow - "HH:MM-HH:MM"
 */
function scheduleReminder(chatId, windowKey, timeWindow) {
  const st = getChatState(chatId);
  const [start] = timeWindow.split('-');
  const runAt = nextReminderDate(start);
  const timeoutMs = runAt.getTime() - Date.now();

  // если уже есть таймер для этого окна — очистим, чтобы не было дублей
  const existing = st.reminders.get(windowKey);
  if (existing) clearTimeout(existing);

  const timeoutId = setTimeout(async () => {
    // при срабатывании удаляем старый таймер
    const current = st.reminders.get(windowKey);
    if (current) st.reminders.delete(windowKey);

    // проверяем, не поменялись ли окна с тех пор
    const fresh = getChatState(chatId).windows[windowKey];
    if (fresh !== timeWindow) {
      // окно изменилось — не шлём старое уведомление
      // но если новое окно задано — перепланируем уже для нового значения
      if (fresh) scheduleReminder(chatId, windowKey, fresh);
      return;
    }

    await sendToChat(`⏰ Через 10 минут начинается ${windowKey === 'morning' ? 'утреннее' : 'вечернее'} окно PR (${timeWindow})! @all`, chatId);

    // планируем следующее напоминание на следующий день
    scheduleReminder(chatId, windowKey, timeWindow);
  }, timeoutMs);

  st.reminders.set(windowKey, timeoutId);
}

/**
 * Команда: /set_windows 10:00-11:00 [18:00-19:00]
 */
bot.command('set_windows', async (ctx) => {
  const chatId = ctx.chat.id;
  const args = ctx.message.text.split(' ').slice(1);

  if (args.length === 0 || args.length > 2) {
    return ctx.reply(
      '❌ Укажите одно или два окна. Примеры:\n' +
      '/set_windows 10:00-11:00\n' +
      '/set_windows 10:00-11:00 18:00-19:00'
    );
  }
  if (!args.every(isValidTimeWindow)) {
    return ctx.reply('❌ Неверный формат времени. Используйте: HH:MM-HH:MM');
  }

  const st = getChatState(chatId);

  // Обновляем окна
  st.windows.morning = args[0];
  st.windows.evening = args[1] ?? null;

  // Перепланируем таймеры строго в рамках этого чата
  clearChatReminders(chatId);
  scheduleReminder(chatId, 'morning', st.windows.morning);
  if (st.windows.evening) scheduleReminder(chatId, 'evening', st.windows.evening);

  let response = '🕒 Установлены окна для PR:\n';
  response += `☀️ Утро: ${st.windows.morning}\n`;
  if (st.windows.evening) response += `🌙 Вечер: ${st.windows.evening}\n`;
  response += '\nЯ буду напоминать за 10 минут до начала!';

  await ctx.reply(response);

  // Если нужно продублировать в общий канал/группу — укажи TARGET_CHAT_ID в .env
  if (DEFAULT_TARGET_CHAT_ID && String(DEFAULT_TARGET_CHAT_ID) !== String(chatId)) {
    await sendToChat(response + '\n@all', DEFAULT_TARGET_CHAT_ID);
  }
});

/**
 * Команда: /show_windows
 */
bot.command('show_windows', (ctx) => {
  const chatId = ctx.chat.id;
  const st = getChatState(chatId);

  if (!st.windows.morning && !st.windows.evening) {
    return ctx.reply('ℹ️ Окна не установлены. Используйте /set_windows');
  }

  let response = '📅 Текущие окна:\n';
  if (st.windows.morning) response += `☀️ Утро: ${st.windows.morning}\n`;
  if (st.windows.evening) response += `🌙 Вечер: ${st.windows.evening}\n`;

  ctx.reply(response);
});

// Завершение работы — чистим все таймеры
function clearAllRemindersAllChats() {
  for (const [chatId] of chatStates) clearChatReminders(chatId);
}

process.once('SIGINT', () => {
  clearAllRemindersAllChats();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  clearAllRemindersAllChats();
  bot.stop('SIGTERM');
});

// Логирование необработанных ошибок
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});

/**
 * Запуск
 */
bot.launch()
  .then(() => console.log('🤖 Бот запущен'))
  .catch(err => console.error('🚨 Ошибка запуска:', err));
