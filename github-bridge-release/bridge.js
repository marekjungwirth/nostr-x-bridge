// ====== Importy ======
require('dotenv').config(); 
global.WebSocket = require('ws');
const { TwitterApi } = require('twitter-api-v2');
const { getPublicKey, nip19, finalizeEvent, SimplePool } = require('nostr-tools');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// ====== Konfigurace (Načtení z .env) ======
const {
    X_API_KEY,
    X_API_SECRET,
    X_ACCESS_TOKEN,
    X_ACCESS_SECRET,
    NOSTR_BOT_NSEC,
    X_ACCOUNT_ID_TO_FOLLOW,
    NOSTR_BUILD_API_KEY 
} = process.env;

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://nos.lol',
  'wss://relay.nostr.band'
];

// !!!!! ZMĚNA ZDE: Kontrolujeme jen 1x za 15 minut (900000 ms) !!!!!
const CHECK_INTERVAL_MS = 900000; 
const TEMP_DIR = path.join(__dirname, 'temp_images');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

// Globální proměnné
let xClient; 
let nostrPool; 
let nostrBotSk; 
let nostrBotPk; 
let lastPostedTweetId = null; 

// --- Funkce pro obrázky (downloadImage, uploadToVoidCat, uploadToNostrBuild) ---
// (Tyto funkce jsou v pořádku, necháme je, jak byly)
async function downloadImage(url, filename) {
    const filePath = path.join(TEMP_DIR, filename);
    try {
        const response = await axios({ url, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(filePath));
            writer.on('error', reject);
        });
    } catch (error) {
        console.error(`Chyba při stahování obrázku ${url}:`, error.message);
        return null;
    }
}
async function uploadToVoidCat(filePath) {
    try {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath));
        const response = await axios.post('https://void.cat/upload', formData, {
            headers: formData.getHeaders(),
            maxContentLength: Infinity, maxBodyLength: Infinity
        });
        if (response.data && response.data.file) {
            const imageUrl = `https://void.cat/d/${response.data.file.id}`;
            console.log(`✅ Obrázek nahrán na void.cat: ${imageUrl}`);
            return imageUrl;
        }
        return null;
    } catch (error) {
        console.error('Chyba při nahrávání na void.cat:', error.message);
        return null;
    }
}
async function uploadToNostrBuild(filePath) {
    if (!NOSTR_BUILD_API_KEY) return null; 
    try {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath));
        const response = await axios.post('https://nostr.build/api/v2/upload/files', formData, {
            headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${NOSTR_BUILD_API_KEY}` },
            maxContentLength: Infinity, maxBodyLength: Infinity
        });
        if (response.data && response.data.data && response.data.data[0]) {
            const imageUrl = response.data.data[0].url;
            console.log(`✅ Obrázek nahrán na nostr.build: ${imageUrl}`);
            return imageUrl;
        }
        return null;
    } catch (error) {
        console.error('Chyba při nahrávání na nostr.build:', error.message);
        return null;
    }
}

// --- Funkce pro Nostr (Ověřená a funkční) ---
async function publishToRelay(url, eventToPublish) {
  let relay;
  try {
    relay = await nostrPool.ensureRelay(url); 
    console.log(`[${url}] Připojeno. Odesílám...`);
    await relay.publish(eventToPublish);
    console.log(`[${url}] ✅ OK - Přijato.`);
    return { status: 'ok', url };
  } catch (error) {
    const errorMessage = error.message || error.toString();
    console.log(`[${url}] ❌ FAILED: ${errorMessage}`);
    return { status: 'failed', url, error: errorMessage };
  }
}

async function publishNote(content, imageUrls = []) {
    console.log(`Připravuji Nostr poznámku...`);
    try {
        // --- Úprava textu a odkazů ---
        let fullContent = content;

        // Pokud máme vlastní obrázky, chceme se zbavit původního t.co odkazu na média
        if (imageUrls.length > 0) {
            // Agresivní regex: Najde t.co odkaz na konci textu
            // Twitter dává odkaz na média vždy na úplný konec
            fullContent = fullContent.replace(/https:\/\/t\.co\/[a-zA-Z0-9]+\s*$/, '').trim();
        }
        
        // Připravíme tagy
        const tags = [['client', 'x-nostr-bridge']];
        
        // Přidáme obrázky jako 'imeta' tagy (NIP-94) a zároveň do textu
        if (imageUrls.length > 0) { 
            imageUrls.forEach((url) => {
                tags.push(['imeta', `url ${url}`]);
            });
            // Přidáme naše nové URL na konec textu
            fullContent += '\n\n' + imageUrls.join('\n'); 
        }
        
        // (Původní odkaz na tweet už tam nevracíme, pokud máme obrázky, protože by dělal ten embed)
        // Pokud obrázky nemáme, t.co odkaz v textu zůstane (což je správně, ať je na co klikat)

        let event = finalizeEvent({
          kind: 1, 
          created_at: Math.floor(Date.now() / 1000), 
          tags: tags, 
          content: fullContent,
        }, nostrBotSk); 

        console.log("Odesílám na relaye...");
        const results = await Promise.allSettled(
            RELAYS.map(relayUrl => publishToRelay(relayUrl, event))
        );
        
        const successCount = results.filter(r => r.status === 'fulfilled' && r.value.status === 'ok').length;
        console.log(`--- DOKONČENO ---`);
        console.log(`Poznámka odeslána (potvrzeno ${successCount} z ${RELAYS.length} relayů).`);
        return successCount > 0;
        
    } catch (error) {
        console.error("Chyba při odesílání na Nostr:", error);
        return false;
    }
}

// --- HLAVNÍ SMYČKA BOTA ---
async function mainLoop() {  
  console.log(`[${new Date().toLocaleString('cs-CZ')}] Kontroluji nové tweety...`);  
  try {    
    // Připravíme parametry bez since_id    
    let params = {      
      "tweet.fields": ["id", "text", "attachments", "referenced_tweets"],      
      "expansions": ["attachments.media_keys"],       
      "media.fields": ["type", "url", "preview_image_url"],       
      exclude: ["replies", "retweets"],      
      max_results: 5     
    };    
    
    // Přidáme since_id JEN pokud existuje (není null)    
    if (lastPostedTweetId) {      
      params.since_id = lastPostedTweetId;      
      console.log(`Používám since_id: ${lastPostedTweetId}`);    
    } else {      
      console.log('Žádný since_id – hledám všechny nejnovější tweety.');    
    }    
    
    const timeline = await xClient.v2.userTimeline(X_ACCOUNT_ID_TO_FOLLOW, params);    
    const mediaData = timeline.includes?.media || [];    
    
    if (!timeline.data?.data || timeline.data.data.length === 0) {      
      console.log("Žádné nové tweety k odeslání.");      
      return;     
    }    
    
    const newTweets = timeline.data.data.reverse();    
    for (const tweet of newTweets) {      
      console.log(`\n📝 Nalezen nový tweet (ID: ${tweet.id}): ${tweet.text.substring(0, 50)}...`);      
      let imageUrls = [];      
      if (tweet.attachments && tweet.attachments.media_keys) {          
          console.log(`📷 Tweet obsahuje média, zpracovávám...`);          
          for (const mediaKey of tweet.attachments.media_keys) {              
              const media = mediaData.find(m => m.media_key === mediaKey);              
              if (media && media.type === 'photo' && media.url) {                  
                  const filename = `tweet_${tweet.id}_${mediaKey}.jpg`;                  
                  console.log(`Stahuji obrázek: ${media.url}`);                  
                  const localPath = await downloadImage(media.url, filename);                  
                  if (localPath) {                      
                      let uploadedUrl = await uploadToNostrBuild(localPath);                       
                      if (!uploadedUrl) {                          
                          console.log('Nostr.build selhal/není klíč, zkouším void.cat...');                          
                          uploadedUrl = await uploadToVoidCat(localPath);                       
                      }                      
                      if (uploadedUrl) { imageUrls.push(uploadedUrl); }                      
                      fs.unlinkSync(localPath);                   
                  }              
              } else {                  
                  console.log(`Přeskakuji médium ${mediaKey} (typ: ${media?.type})`);              
              }          
          }          
          console.log(`✅ Zpracováno ${imageUrls.length} obrázků`);      
      }      
      await publishNote(tweet.text, imageUrls);      
      lastPostedTweetId = tweet.id;       
      await new Promise(resolve => setTimeout(resolve, 3000));    
    }  
  } catch (e) {    
    console.error(`CHYBA při kontrole X API: ${e.message}`);    
    // Speciální handling pro Rate Limit    
    if (e.message && e.message.includes('429')) {        
        console.warn("NARAZILI JSME NA RATE LIMIT (429). Zastavuji smyčku.");        
        // Zastavíme automatické opakování, abychom X nenaštvali        
        clearInterval(mainInterval);         
        console.warn(`Smyčka zastavena. Zkus skript restartovat ručně za 15-20 minut.`);    
    }  
  }
}

let mainInterval; 

function startMainLoop() {
    console.log("Spouštím hlavní smyčku (mainLoop) poprvé...");
    mainLoop(); // Spustíme hned
    // A pak každých X minut (podle nastavení nahoře)
    mainInterval = setInterval(mainLoop, CHECK_INTERVAL_MS); 
}

/**
 * Hlavní funkce pro inicializaci
 */
async function main() {
  console.log("Spouštím X->Nostr Bridge (v2, s podporou obrázků)...");

  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_SECRET || !NOSTR_BOT_NSEC || !X_ACCOUNT_ID_TO_FOLLOW) {
      console.error("CHYBA: Chybí klíčové proměnné v .env souboru! (Potřebujeme VŠECHNY 4 X klíče, NSEC a ID)");
      process.exit(1); 
  }

  // --- Inicializace Nostr ---
  try {
      nostrBotSk = nip19.decode(NOSTR_BOT_NSEC).data;
      nostrBotPk = getPublicKey(nostrBotSk);
      const npub = nip19.npubEncode(nostrBotPk);
      console.log(`Nostr bot inicializován.`);
      console.log(`Budu posílat jako: ${npub}`);
      nostrPool = new SimplePool();
  } catch (e) {
      console.error("CHYBA: Selhala inicializace Nostr. Je NSEC klíč správný?", e.message);
      return;
  }

  // --- Inicializace X (Twitter) ---
  try {
      xClient = new TwitterApi({
          appKey: X_API_KEY,
          appSecret: X_API_SECRET,
          accessToken: X_ACCESS_TOKEN,
          accessSecret: X_ACCESS_SECRET,
      });
      xClient = xClient.readWrite; 
      console.log("X API klient inicializován (s plným User ověřením).");
  } catch (e) {
      console.error("CHYBA: Selhala inicializace X API:", e.message);
      return;
  }

  // --- TESTOVACÍ KROKY ---
  let userName = "NEZNÁMÝ ÚČET";
  console.log("--- Spouštím testovací připojení ---");
  try {
      // Otestujeme v1.1 endpoint (ověření přihlášení)
      const meUser = await xClient.v1.verifyCredentials();
      console.log(`[X API Test v1] ✅ OK: Připojeno jako @${meUser.screen_name}`);
      
      // Přeskočíme v2 test, abychom neplýtvali limitem
      console.log(`[X API Test v2] ⚠️ PŘESKOČENO: Budu sledovat ID ${X_ACCOUNT_ID_TO_FOLLOW}`);
      userName = X_ACCOUNT_ID_TO_FOLLOW; // Budeme v logu používat jen ID
      
  } catch (e) {
      console.log(`[X API Test] ❌ CHYBA: Selhání při ověření přihlášení v1: ${e.message}`);
      nostrPool.close(RELAYS);
      return;
  }
  
//  const testMessage = `[START] X->Nostr bridge bot je online. Sleduji ID: ${userName}. Kontroluji každých ${CHECK_INTERVAL_MS / 1000 / 60} minut.`;
//  await publishNote(testMessage);
  
  console.log("--- Testovací připojení dokončeno ---");
  
  // --- Spuštění hlavní smyčky ---
  startMainLoop();
}

// Spustíme to!
main();

