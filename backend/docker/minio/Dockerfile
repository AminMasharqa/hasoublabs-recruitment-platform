# MinIO, compiled from its upstream source for local development.
#
# MinIO no longer publishes community images (minio/minio and quay.io/minio/minio
# are not pullable) or binaries (dl.min.io answers 410), but the AGPL source is
# still tagged on GitHub. This builds one pinned release tag. The app depends on
# object lock (COMPLIANCE) and SSE-KMS, which an S3 lookalike may not provide.
#
# The first build takes a few minutes. After that the image is cached locally.

ARG MINIO_RELEASE=RELEASE.2025-10-15T17-29-55Z

FROM golang:1.24-alpine AS build
ARG MINIO_RELEASE
RUN apk add --no-cache git
RUN git clone --depth 1 --branch "${MINIO_RELEASE}" https://github.com/minio/minio.git /src
WORKDIR /src
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/minio .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /out/minio /usr/bin/minio
EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/minio"]
