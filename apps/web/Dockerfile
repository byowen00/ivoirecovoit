# Image de production du site web et de l'administration. Construire depuis la racine du dépôt :
#   docker build -f apps/web/Dockerfile -t ivoirecovoit-web .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @ivoirecovoit/web...
COPY apps/web apps/web
ARG NEXT_PUBLIC_ENVIRONMENT=development
ENV NEXT_PUBLIC_ENVIRONMENT=$NEXT_PUBLIC_ENVIRONMENT
# API_INTERNAL_URL est lu au build par les règles de réécriture de Next.js
ARG API_INTERNAL_URL=http://backend:3000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
RUN pnpm --filter @ivoirecovoit/web build

FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3001
CMD ["node", "apps/web/server.js"]
