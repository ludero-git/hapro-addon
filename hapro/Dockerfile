ARG BUILD_FROM
ARG BUILD_ARCH=amd64
FROM ghcr.io/bitfox-git/rathole:latest as rathole
FROM caddy:latest as caddy
FROM oven/bun:latest as bun
FROM docker:cli as docker-cli
FROM $BUILD_FROM
ARG BUILD_ARCH=amd64
ENV DEBIAN_FRONTEND=noninteractive
RUN apt update && apt install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    htop \
    iproute2 \
    iputils-ping \
    jq \
    less \
    nano \
    net-tools \
    netcat-openbsd \
    nmap \
    openssh-client \
    procps \
    unzip \
    wget \
    zip \
    && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/BeryJu/hass-auth-header /usr/src/hass-auth-header
COPY hass-auth-header /usr/src/hass-auth-header

COPY --from=bun  /usr/local/bin/bun /usr/bin/bun
COPY --from=rathole /app/rathole /usr/bin/rathole
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY --from=docker-cli /usr/local/bin/docker /usr/bin/docker
RUN curl -L -s -f "https://github.com/home-assistant/cli/releases/latest/download/ha_${BUILD_ARCH}" -o /usr/bin/ha && chmod +x /usr/bin/ha
COPY rootfs /

WORKDIR /usr/src
RUN bun install