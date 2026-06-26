FROM node:22-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install
COPY backend/ ./backend/
COPY frontend/ ./frontend/
EXPOSE 8000
CMD ["node", "backend/server.js"]
