# Agent image for the factory harness: the standalone `claude` binary plus the
# small toolset the in-container scripts need. Runs inside an Apple `container`
# micro-VM, so nothing here touches the host.
FROM debian:trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      curl git jq ca-certificates bash python3 nodejs npm \
 && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:${PATH}"
RUN curl -fsSL https://claude.ai/install.sh | bash

WORKDIR /workspace
