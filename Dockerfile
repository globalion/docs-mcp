# Multi-stage build. Runner image ships LibreOffice + Poppler because the
# ingest pipeline shells out to `libreoffice --headless --convert-to pdf`
# (Word/Excel/PowerPoint → PDF) and `pdftoppm -png` (PDF → per-page images).
# Vision model runs on those images.

FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm install

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# LibreOffice + Poppler for document conversion. `libreoffice-core` +
# `libreoffice-writer/impress/calc` covers docx/pptx/xlsx → pdf. `poppler-utils`
# provides `pdftoppm` which slices a PDF into per-page PNGs at any DPI.
# fonts-liberation covers most Word/PowerPoint fonts so conversions don't
# fall back to Times New Roman.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-core libreoffice-writer libreoffice-impress libreoffice-calc \
      poppler-utils \
      fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --home /home/nextjs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/package.json ./

# Per-user document storage — mounted as a volume in compose so raw files
# survive container rebuilds. LibreOffice also drops a ~/.config/libreoffice
# directory here on first run.
RUN mkdir -p /data/docs && chown -R nextjs:nodejs /data
VOLUME ["/data"]

ENV HOME=/home/nextjs
USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "npx --yes prisma@6.19.2 migrate deploy 2>/dev/null; npx --yes prisma@6.19.2 db push --accept-data-loss --skip-generate && node server.js"]
