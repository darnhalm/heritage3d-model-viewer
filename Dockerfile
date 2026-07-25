# Static viewer: build with Node, serve with nginx.
# Run: docker build -t heritage3d-viewer . && docker run --rm -p 8080:80 heritage3d-viewer
# Open: http://localhost:8080

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
