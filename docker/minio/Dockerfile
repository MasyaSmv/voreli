FROM golang:1.24-bookworm AS build

WORKDIR /src
# RELEASE.2025-09-07T16-13-09Z, matching the previously tested upstream image.
RUN git init \
    && git remote add origin https://github.com/minio/minio.git \
    && git fetch --depth=1 origin 32d8e5209f029a1fb7235308ab32253bface1001 \
    && git checkout --detach FETCH_HEAD
RUN CGO_ENABLED=0 go build -mod=readonly -trimpath -o /out/minio .

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/minio /usr/local/bin/minio
COPY --from=build /src/LICENSE /usr/share/licenses/minio/LICENSE
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.revision="32d8e5209f029a1fb7235308ab32253bface1001" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
