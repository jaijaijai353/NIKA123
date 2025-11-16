# Stage 1: Build the frontend
FROM node:18-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Build the backend
FROM node:18-alpine AS backend
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm install
COPY backend .
RUN npm run build

# Stage 3: Create the production image
FROM node:18-alpine
WORKDIR /app
COPY --from=frontend /app/dist ./dist
COPY --from=backend /app/dist ./backend/dist
COPY --from=backend /app/node_modules ./backend/node_modules
COPY backend/package.json ./backend/
EXPOSE 5000
CMD ["node", "backend/dist/server.js"]
