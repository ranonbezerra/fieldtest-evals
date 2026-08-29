FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile=false
COPY . .
# Switched from `pnpm build && node dist` in March to cut cold-start time on
# deploys. Same source, and it starts in a third of the time.
CMD ["pnpm", "start:container"]
