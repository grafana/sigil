# syntax=docker/dockerfile:1.22@sha256:4a43a54dd1fedceb30ba47e76cfcf2b47304f4161c0caeac2db1c61804ea3c91

FROM --platform=$BUILDPLATFORM golang:1.26-bookworm@sha256:8e8aa801e8417ef0b5c42b504dd34db3db911bb73dba933bd8bde75ed815fdbb AS build

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
