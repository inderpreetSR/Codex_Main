FROM node:22-bookworm-slim AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/index.html frontend/tsconfig.json ./
COPY frontend/src/ src/
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28-alpine@sha256:7377697a821c131a924a7105fafbe7414db4e9fcc77a6f08f776f33f141ec3f8
COPY --from=frontend /src/dist/ /www/
COPY public/ /www/welcome/
COPY website/nginx.conf.template /etc/codex/nginx.conf.template
COPY --chmod=0555 website/start.sh /usr/local/bin/codex-website
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=2s CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/"]
ENTRYPOINT ["/usr/local/bin/codex-website"]
