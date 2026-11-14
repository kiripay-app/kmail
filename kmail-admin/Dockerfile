FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
COPY ui ./ui
RUN cd ui && npm install && npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/ui/dist ./ui/dist
RUN mkdir /data && chown node:node /data
USER node
ENV DATA_DIR=/data NODE_OPTIONS=--disable-warning=ExperimentalWarning
VOLUME /data
EXPOSE 3100
CMD ["node", "dist/index.js"]
