FROM node:22-alpine

RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    && pip3 install --no-cache-dir yt-dlp \
    && rm -rf /root/.cache/pip

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm install

COPY backend/ ./backend/
COPY frontend/ ./frontend/

EXPOSE 8000

CMD ["node", "backend/server.js"]
