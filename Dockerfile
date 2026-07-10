# --- Build Stage ---
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source files and build
COPY . .
RUN npm run build

# --- Production Stage ---
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx template configuration
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template

# Expose port (Cloud Run will set PORT env var, defaults to 8080 here)
ENV PORT=8080
EXPOSE 8080

# Substitute PORT in nginx template and start nginx
CMD ["/bin/sh", "-c", "envsubst '$PORT' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
