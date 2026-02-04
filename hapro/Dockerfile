ARG BUILD_FROM
FROM ghcr.io/bitfox-git/rathole:latest as rathole
FROM caddy:builder AS caddy-builder
RUN GOAMD64=v2 xcaddy build
FROM oven/bun:latest as bun
FROM $BUILD_FROM
ENV DEBIAN_FRONTEND=noninteractive
RUN apt update && apt install -y git && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/BeryJu/hass-auth-header /usr/src/hass-auth-header
COPY hass-auth-header /usr/src/hass-auth-header

COPY --from=bun  /usr/local/bin/bun /usr/bin/bun
COPY --from=rathole /app/rathole /usr/bin/rathole
COPY --from=caddy-builder /usr/bin/caddy /usr/bin/caddy
COPY rootfs /