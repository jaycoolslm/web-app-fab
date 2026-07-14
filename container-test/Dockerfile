# Minimal agent image + tools to probe Supabase from inside the Linux micro-VM.
# The claude standalone installer ships a self-contained binary, so no Node base needed.
FROM debian:trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl git jq ca-certificates bash \
 && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:${PATH}"
RUN curl -fsSL https://claude.ai/install.sh | bash

COPY probe.sh /usr/local/bin/probe.sh
RUN chmod +x /usr/local/bin/probe.sh

WORKDIR /workspace
