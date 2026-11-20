FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY public ./public
COPY server.mjs simulation.mjs simulation-runner.mjs simulation-worker.mjs ./
ENV NODE_ENV=production PORT=3000 MAX_ROOMS=2
EXPOSE 3000
CMD ["npm", "start"]
