FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

COPY worker/package.json ./
RUN npm install

COPY worker/index.js ./
COPY worker/runner.js ./

COPY automation/ ./automation/
COPY lib/ ./lib/

CMD ["node", "index.js"]
