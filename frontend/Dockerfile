FROM node:22-alpine AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ .

ARG VITE_API_URL=
ARG VITE_USER_NAME=冠池
ARG VITE_USER_BADGE=个人理财空间

ENV VITE_API_URL=${VITE_API_URL} \
    VITE_USER_NAME=${VITE_USER_NAME} \
    VITE_USER_BADGE=${VITE_USER_BADGE}

RUN npm run build

FROM nginx:1.27-alpine

COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/snippets/ /etc/nginx/snippets/
COPY deploy/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
