FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

COPY worker/package.json ./
RUN npm install

COPY worker/index.js ./
COPY worker/runner.js ./
COPY worker/project-root.js ./
COPY worker/verify-noc-trigger.js ./
COPY worker/handlers ./handlers

COPY automation/ ./automation/
COPY lib/ ./lib/

RUN node verify-noc-trigger.js || (echo "ERROR: legacy NOC HTTP trigger in automation copy" && exit 1)

# Do not bake ENVIRONMENT/NODE_ENV here — Railway injects them at runtime.
CMD ["node", "index.js"]
