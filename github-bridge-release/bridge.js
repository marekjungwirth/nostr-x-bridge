// ====== X -> Nostr Bridge v6.1 - Updated 2025-11-22 ======

require('dotenv').config();
global.WebSocket = require('ws');
const { TwitterApi } = require('twitter-api-v2');
const { getPublicKey, nip19, finalizeEvent, SimplePool } = require('nostr-tools');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// ====== Configuration ======
const {
    X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET,
    NOSTR_BOT_NSEC, X_ACCOUNT_ID_TO_FOLLOW
} = process.env;

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net'
];

const CHECK_INTERVAL_MS = 60000; // 1 minute
const TEMP_DIR = path.join(__dirname, 'temp_images');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

let xClient;
let nostrPool;
let nostrBotSk;
let nostrBotPk;
let lastPostedTweetId = null;

// ====== Upload Functions (Multiple Fallbacks) ======
async function uploadImage(filePath) {
    const uploaders = [
        () => uploadToNostrBuild(filePath),   // 1. nostr.build
        () => uploadToNostrImg(filePath),     // 2. nostrimg.com
    ];

    for (const uploader of uploaders) {
        try {
            const url = await uploader();
            if (url) {
                console.log(`✅ Upload successful -> ${url}`);
                return url;
            }
        } catch (e) {
            console.warn(`⚠️ ${uploader.name} failed:`, e.message);
        }
    }
    console.error('❌ All uploaders failed.');
    return null;
}

// 1. nostr.build
async function uploadToNostrBuild(filePath) {
    const form = new FormData();
    form.append('file[]', fs.createReadStream(filePath));
    const res = await axios.post('https://nostr.build/api/v2/upload/files', form, {
        headers: form.getHeaders(),
        timeout: 30000,
        maxBodyLength: Infinity
    });
    return res.data?.[0]?.url || res.data?.url || null;
}

// 2. nostrimg.com
async function uploadToNostrImg(filePath) {
    const form = new FormData();
    form.append('fileToUpload', fs.createReadStream(filePath));
    const res = await axios.post('https://nostrimg.com/api/upload', form, {
        headers: form.getHeaders(),
        timeout: 20000
    });
    return res.data?.url || null;
}

// ====== Image Downloading ======
async function downloadImage(url, filename) {
    const filePath = path.join(TEMP_DIR, filename);
    try {
        const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 30000 });
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(filePath));
            writer.on('error', reject);
        });
    } catch (e) {
        console.error('❌ Download failed:', e.message);
        return null;
    }
}

// ====== Publish to Nostr ======
async function publishNote(content, imageUrls = [], tweetId) {
    let fullContent = content.trim();

    const tags = [
        ['client', 'x-nostr-bridge'],
        ['source', 'x'],
        ['e', tweetId, 'wss://njump.me', 'root']
    ];

    if (imageUrls.length > 0) {
        // Remove original t.co links
        fullContent = fullContent.replace(/https:\/\/t\.co\/[a-zA-Z0-9]+/g, '').trim();

        // Add imeta tags (NIP-94)
        imageUrls.forEach(url => {
            tags.push(['imeta', `url ${url}`]);
        });

        // Add image URLs to text for compatibility
        fullContent += '\n\n' + imageUrls.map(u => u).join('\n');
    }

    // Add source link
    fullContent += `\n\nOriginal source: https://x.com/i/web/status/${tweetId}`;

    const event = finalizeEvent({
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: fullContent,
    }, nostrBotSk);

    const results = await Promise.allSettled(
        RELAYS.map(url => nostrPool.ensureRelay(url).then(r => r.publish(event)))
    );

    const ok = results.filter(r => r.status === 'fulfilled').length;
    console.log(`✨ Published to ${ok}/${RELAYS.length} relays`);
    return ok > 0;
}

// ====== Main Loop ======
async function mainLoop() {
    console.log(`\n[${new Date().toLocaleString()}] Checking for new tweets...`);
    try {
        const timeline = await xClient.v2.userTimeline(X_ACCOUNT_ID_TO_FOLLOW, {
            "tweet.fields": ["id", "text", "attachments"],
            "expansions": ["attachments.media_keys"],
            "media.fields": ["type", "url"],
            exclude: ["replies", "retweets"],
            max_results: 10,
            since_id: lastPostedTweetId
        });

        const mediaData = timeline.includes?.media || [];
        if (!timeline.data?.data?.length) return;

        const newTweets = timeline.data.data.reverse();
        for (const tweet of newTweets) {
            console.log(`\n📝 New tweet ${tweet.id}: ${tweet.text.substring(0, 50)}...`);

            let imageUrls = [];

            if (tweet.attachments?.media_keys) {
                console.log(`📷 Processing ${tweet.attachments.media_keys.length} images...`);
                for (const key of tweet.attachments.media_keys) {
                    const media = mediaData.find(m => m.media_key === key);
                    if (media?.type === 'photo' && media.url) {
                        const filename = `tweet_${tweet.id}_${key}.jpg`;
                        const localPath = await downloadImage(media.url, filename);
                        if (localPath) {
                            const uploaded = await uploadImage(localPath);
                            if (uploaded) imageUrls.push(uploaded);
                            try { fs.unlinkSync(localPath); } catch {}
                        }
                    }
                }
            }

            await publishNote(tweet.text, imageUrls, tweet.id);
            lastPostedTweetId = tweet.id;

            await new Promise(r => setTimeout(r, 4000)); // Rate limit safety
        }
    } catch (e) {
        console.error('Error in loop:', e.message);
        if (e.code === 429) {
            console.warn('Rate limit hit - waiting...');
            process.exit(1);
        }
    }
}

// ====== Initialization ======
async function main() {
    console.log("Starting X -> Nostr Bridge...");
    if (!X_API_KEY || !NOSTR_BOT_NSEC || !X_ACCOUNT_ID_TO_FOLLOW) {
        console.error("Missing environment variables!");
        process.exit(1);
    }

    nostrBotSk = nip19.decode(NOSTR_BOT_NSEC).data;
    nostrBotPk = getPublicKey(nostrBotSk);
    nostrPool = new SimplePool();

    xClient = new TwitterApi({
        appKey: X_API_KEY,
        appSecret: X_API_SECRET,
        accessToken: X_ACCESS_TOKEN,
        accessSecret: X_ACCESS_SECRET,
    }).readWrite;

    await mainLoop(); // First run
    setInterval(mainLoop, CHECK_INTERVAL_MS);
}

main();
