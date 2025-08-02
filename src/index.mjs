import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Храним окна в памяти (в реальном проекте лучше использовать БД)
let windows = {
    morning: null,
    evening: null
};

// Команда /set_windows 10:00-11:00 18:00-19:00
bot.command('set_windows', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1); // Убираем "/set_windows"
    
    if (args.length !== 2) {
        return ctx.reply('❌ Нужно указать ДВА окна. Пример:\n/set_windows 10:00-11:00 18:00-19:00');
    }

    const [morningWindow, eveningWindow] = args;
    const timeRegex = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/;

    if (!timeRegex.test(morningWindow) || !timeRegex.test(eveningWindow)) {
        return ctx.reply('❌ Неверный формат времени. Используйте: HH:MM-HH:MM');
    }

    // Сохраняем окна
    windows.morning = morningWindow;
    windows.evening = eveningWindow;

    // Отправляем подтверждение
    ctx.reply(
        `🕒 Установлены окна для PR:\n` +
        `☀️ Утро: ${morningWindow}\n` +
        `🌙 Вечер: ${eveningWindow}\n\n` +
        `Участники, не забывайте проверять код! @all`
    );
});

// Команда /show_windows — показать текущие окна
bot.command('show_windows', (ctx) => {
    if (!windows.morning || !windows.evening) {
        return ctx.reply('❌ Окна не установлены. Используйте /set_windows');
    }

    ctx.reply(
        `📅 Текущие окна для PR:\n` +
        `☀️ Утро: ${windows.morning}\n` +
        `🌙 Вечер: ${windows.evening}`
    );
});

// Запуск бота
bot.launch()
    .then(() => console.log('Бот запущен!'))
    .catch(err => console.error('Ошибка:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));