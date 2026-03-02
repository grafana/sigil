# syntax=docker/dockerfile:1.21@sha256:27f9262d43452075f3c410287a2c43f5ef1bf7ec2bb06e8c9eeb1b8d453087bc

FROM --platform=$BUILDPLATFORM golang:1.26-bookworm@sha256:2a0ba12e116687098780d3ce700f9ce3cb340783779646aafbabed748fa6677c AS build

ARG TARGETOS TARGETARCH

WORKDIR /src

ENV CGO_ENABLED=0

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/sigil ./cmd/sigil

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -r sigil && useradd -r -u 10001 -g sigil sigil

WORKDIR /app

COPY --from=build /out/sigil /usr/local/bin/sigil

USER sigil:sigil

EXPOSE 8080
EXPOSE 4317

ENTRYPOINT ["/usr/local/bin/sigil"]
