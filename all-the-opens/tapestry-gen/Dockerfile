# The streaming live-discovery demo (serve.js) as a container, for Fly.io.
# The disk cache lives in the container's ephemeral filesystem: it warms over
# the machine's lifetime and vanishes on redeploy, which is the right
# durability for a cache whose only job is politeness and repeat-view speed.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY serve.js ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "serve.js"]
