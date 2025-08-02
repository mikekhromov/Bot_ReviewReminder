/**
 * @file Telegram бот для управления временными окнами code review
 * @description Позволяет устанавливать одно или два временных окна для PR и отправляет напоминания
 * @module PRReminderBot
 */

import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

// Инициализация окружения
dotenv.config();

/**
 * Экземпляр бота Telegram
 * @type {Telegraf}
 */
const bot = new Telegraf(process.env.BOT_TOKEN);

/**
 * ID целевого чата для уведомлений
 * @type {number|string}
 */
const TARGET_CHAT_ID = process.env.TARGET_CHAT_ID;

/**
 * Состояние бота
 * @namespace
 * @property {Object} windows - Временные окна
 * @property {string|null} windows.morning - Утреннее окно (формат HH:MM-HH:MM)
 * @property {string|null} windows.evening - Вечернее окно (формат HH:MM-HH:MM)
 * @property {number|string} chatId - ID текущего чата
 * @property {Set} reminders - Коллекция активных таймеров напоминаний
 */
const state = {
  windows: {
    morning: null,
    evening: null
  },
  chatId: TARGET_CHAT_ID,
  reminders: new Set()
};

/**
 * Проверяет корректность формата временного окна
 * @param {string} timeStr - Строка времени в формате HH:MM-HH:MM
 * @returns {boolean} true если формат корректен
 */
const isValidTimeWindow = (timeStr) => 
  /^([01]?[0-9]|2[0-3]):[0-5][0-9]-([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(timeStr);

/**
 * Очищает все активные напоминания
 * @function clearAllReminders
 */
function clearAllReminders() {
  state.reminders.forEach(timeoutId => clearTimeout(timeoutId));
  state.reminders.clear();
}

/**
 * Устанавливает напоминание для временного окна
 * @function setReminder
 * @param {string} timeStr - Временное окно в формате HH:MM-HH:MM
 * @param {string} windowName - Название окна ('утреннее'/'вечернее')
 */
function setReminder(timeStr, windowName) {
  const [startTime] = timeStr.split('-');
  const [hours, minutes] = startTime.split(':').map(Number);
  
  const now = new Date();
  const reminderTime = new Date();
  reminderTime.setHours(hours, minutes - 10, 0, 0);
  
  if (reminderTime < now) {
    reminderTime.setDate(reminderTime.getDate() + 1);
  }
  
  const timeoutMs = reminderTime - now;
  
  const timeoutId = setTimeout(() => {
    sendToChat(`⏰ Через 10 минут начинается ${windowName} окно PR (${timeStr})! @all`);
    setReminder(timeStr, windowName);
  }, timeoutMs);
  
  state.reminders.add(timeoutId);
}

/**
 * Обработчик команды /set_windows
 * @command set_windows
 * @param {string} args - Аргументы команды (одно или два временных окна)
 * @example /set_windows 10:00-11:00
 * @example /set_windows 10:00-11:00 18:00-19:00
 */
bot.command('set_windows', (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  
  clearAllReminders();
  
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

  state.windows = {
    morning: args[0],
    evening: args.length > 1 ? args[1] : null
  };
  state.chatId = ctx.chat.id;

  setReminder(state.windows.morning, 'утреннее');
  if (state.windows.evening) {
    setReminder(state.windows.evening, 'вечернее');
  }

  let response = '🕒 Установлены окна для PR:\n';
  response += `☀️ Утро: ${state.windows.morning}\n`;
  if (state.windows.evening) {
    response += `🌙 Вечер: ${state.windows.evening}\n`;
  }
  response += '\nЯ буду напоминать за 10 минут до начала!';

  ctx.reply(response);
  
  if (ctx.chat.id !== TARGET_CHAT_ID) {
    sendToChat(response + '\n@all');
  }
});

/**
 * Обработчик команды /show_windows
 * @command show_windows
 * @description Показывает текущие установленные временные окна
 */
bot.command('show_windows', (ctx) => {
  if (!state.windows.morning && !state.windows.evening) {
    return ctx.reply('ℹ️ Окна не установлены. Используйте /set_windows');
  }

  let response = '📅 Текущие окна:\n';
  if (state.windows.morning) {
    response += `☀️ Утро: ${state.windows.morning}\n`;
  }
  if (state.windows.evening) {
    response += `🌙 Вечер: ${state.windows.evening}\n`;
  }
  
  ctx.reply(response);
});

/**
 * Отправляет сообщение в целевой чат
 * @function sendToChat
 * @param {string} message - Текст сообщения
 */
function sendToChat(message) {
  if (!state.chatId) {
    console.error('Chat ID не установлен!');
    return;
  }
  
  bot.telegram.sendMessage(state.chatId, message)
    .catch(err => console.error('Ошибка отправки:', err));
}

// Обработчики завершения работы
process.once('SIGINT', () => {
  clearAllReminders();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  clearAllReminders();
  bot.stop('SIGTERM');
});

/**
 * Запускает бота
 * @function launch
 * @listens bot.launch
 */
bot.launch()
  .then(() => console.log('🤖 Бот запущен'))
  .catch(err => console.error('🚨 Ошибка:', err));