# The streaming live-discovery demo (serve.js) as a container, for Fly.io.
#
# The disk cache is mounted at /app/.cache from a Fly volume (see fly.toml), so
# it survives both redeploys and the scale-to-zero idle stop. It used to live in
# the container's own filesystem, described here as "the right durability for a
# cache whose only job is politeness and repeat-view speed" — that argument was
# about deploys, and it did not survive measuring what actually happened: a
# machine's rootfs is rebuilt from this image on every START, so an idle
# timeout emptied the cache too, and almost every visitor got a cold page.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY serve.js ./
# The mount point must exist in the image; Fly mounts the volume over it.
RUN mkdir -p /app/.cache
ENV PORT=8080
EXPOSE 8080
CMD ["node", "serve.js"]
