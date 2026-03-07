# syntax=docker/dockerfile:1.22@sha256:4a43a54dd1fedceb30ba47e76cfcf2b47304f4161c0caeac2db1c61804ea3c91

FROM --platform=$BUILDPLATFORM golang:1.26-bookworm@sha256:c7a82e9e2df2fea5d8cb62a16aa6f796d2b2ed81ccad4ddd2bc9f0d22936c3f2 AS build

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
