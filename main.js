import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import axios from 'axios'
import fetch from 'node-fetch';

const VIDEOS_PATH = 'videos';
if (!fs.existsSync(VIDEOS_PATH)) {
    fs.mkdirSync(VIDEOS_PATH, { recursive: true });
}

const API_URL = "http://192.168.100.16:8081";
const TELEGRAM_BOT_TOKEN = "7642274113:AAFXa0Ssniv1y9RdzUAWSgbiCY6N5j8UzV0";
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
    polling: true,
    baseApiUrl: API_URL,
});

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeText = "🎉 Welcome to Terabox Downloader! 📥\n\n A cutting edge technology. 🚀";
    const options = {
        caption: welcomeText,
        reply_markup: {
            inline_keyboard: [[{ text: "Download a video 🎬", callback_data: "provide_url" }]]
        }
    };
    bot.sendPhoto(chatId, 'banner.png', options);
});

bot.on('callback_query', (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    if (callbackQuery.data === "provide_url") {
        bot.sendMessage(chatId, "Please provide a valid URL.");
    }
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userMessage = msg.text;
    if (userMessage.startsWith('/start')) return;
    if (isValidUrl(userMessage)) {
        bot.sendMessage(chatId, "URL received! Processing your request...");
        getDownloadLink(chatId, userMessage);
    } else {
        bot.sendMessage(chatId, "Invalid URL. Please enter a valid link.");
    }
});

function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

async function getDownloadLink(chatId, link1) {
    try {
        const url = `https://terabox-downloader-direct-download-link-generator2.p.rapidapi.com/url?url=${link1}`;
        const options = {
        method: 'GET',
            headers: {
                'x-rapidapi-key': '2b589ac6fbmsh1f4b0ca9a6b7a85p1ce177jsn68def80bbb8b',
                'x-rapidapi-host': 'terabox-downloader-direct-download-link-generator2.p.rapidapi.com'
            }
        };

        const response = await fetch(url, options);
        const data = await response.json();  // Use text() to match raw buffer behavior
        const link = data[0].link;
        const name = data[0].file_name
        const size = data[0].size
        if (!link) throw new Error("Invalid response from API: No download link found");

        // Send the file size to the user
        if (size) {
            bot.sendMessage(chatId, `Video found, Title : ${name} Size : ${size}. Pulling video to our server. Please wait for the download to start`);
        } else {
            bot.sendMessage(chatId, "Video found, but size could not be determined. Downloading...");
        }

        // Download the video
        await downloadVideoWithRetry(name, chatId, link, VIDEOS_PATH);
    } catch (error) {
        bot.sendMessage(chatId, "Failed to fetch download link. Try again.");
        console.error("Error:", error);
    }
}

// Map to store the last reported progress per chat ID
const progressMap = new Map();

async function downloadVideoWithRetry(filename, chatId, url, directory, retries = 10) {
    try {
        if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
        const filePath = path.join(directory, filename);
        let downloadedBytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;

        // Get the total file size using the HEAD request
        const headResponse = await axios.head(url);
        const totalSize = parseInt(headResponse.headers['content-length'], 10);

        // Check if the file is already fully downloaded
        if (downloadedBytes >= totalSize) {
            bot.sendMessage(chatId, "File already downloaded. Sending the video ...");
            bot.sendVideo(chatId, filePath);
            return;
        }

        const fileStream = fs.createWriteStream(filePath, { flags: 'a' });
        const response = await axios.get(url, {
            headers: { Range: `bytes=${downloadedBytes}-` },
            responseType: 'stream', // Handle the response as a stream
        });

        const contentLength = totalSize - downloadedBytes;
        let receivedLength = downloadedBytes;

        response.data.on('data', (chunk) => {
            receivedLength += chunk.length;

            const progress = ((receivedLength / totalSize) * 100).toFixed(2);
            const lastReportedProgress = progressMap.get(chatId) || 0;

            if (progress - lastReportedProgress >= 1) { // Update every 1%
                bot.sendMessage(chatId, `Download Progress: ${progress}%`);
                progressMap.set(chatId, progress);
            }
        });

        await new Promise((resolve, reject) => {
            response.data.pipe(fileStream);

            response.data.on('error', (error) => {
                if (retries > 0) {
                    setTimeout(() => downloadVideoWithRetry(filename, chatId, url, directory, retries - 1), 5000);
                    reject(error);
                } else {
                    reject(new Error("Max retries reached. Download failed."));
                }
            });

            fileStream.on('finish', resolve);
        });

        bot.sendMessage(chatId, "Download complete! Sending video...");
        bot.sendVideo(chatId, filePath);
        progressMap.delete(chatId); // Clear the progress once download is complete
    } catch (error) {
        if (retries > 0) {
            setTimeout(() => downloadVideoWithRetry(filename, chatId, url, directory, retries - 1), 5000);
        } else {
            console.error(`Error downloading video: ${error.message}`);
            progressMap.delete(chatId); // Clear the progress in case of failure
        }
    }
}
