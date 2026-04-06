FROM eclipse-temurin:17-jdk-jammy AS base

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://get.digitalasset.com/install/install.sh | sh
ENV PATH="/root/.dpm/bin:${PATH}"
RUN dpm install 3.4.11

FROM golang:1.22-bookworm AS builder
WORKDIR /build
COPY compile-service/go.mod ./
RUN go mod download
COPY compile-service/ ./
RUN CGO_ENABLED=0 go build -o /compile-service .

FROM eclipse-temurin:17-jdk-jammy
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY --from=base /root/.dpm /root/.dpm
ENV PATH="/root/.dpm/bin:${PATH}"

COPY --from=builder /compile-service /usr/local/bin/compile-service

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 7575 8081
ENTRYPOINT ["/entrypoint.sh"]
