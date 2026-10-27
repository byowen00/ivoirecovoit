# Image de production de l'API. Construire depuis la racine du dépôt :
#   docker build -f apps/backend/Dockerfile -t ivoirecovoit-backend .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile --filter @ivoirecovoit/backend...
COPY apps/backend apps/backend
RUN pnpm --filter @ivoirecovoit/backend build \
 && pnpm deploy --filter @ivoirecovoit/backend --prod /out \
 && cp -r apps/backend/dist /out/dist

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
