FROM node:20-alpine

WORKDIR /app

# Kopírujeme package.json pro instalaci závislostí
COPY package*.json ./
RUN npm install

# Kopírujeme zbytek aplikace
COPY . .

# Vytvoříme složku pro obrázky
RUN mkdir -p temp_images

CMD ["node", "bridge.js"]
