# Judge Mode out of the box. Live check-ins need the SDK too: build with --build-arg WITH_SDK=1.
FROM node:24-bookworm-slim
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /app
COPY . .
RUN NODE_ENV=development pnpm install --frozen-lockfile && pnpm build
ARG WITH_SDK=0
RUN if [ "$WITH_SDK" = "1" ]; then npm install --prefix apps/vitals-worker/runtime --no-audit --no-fund; fi
ENV PORT=8787
EXPOSE 8787
CMD ["pnpm", "--filter", "@rollcall/api", "start"]
