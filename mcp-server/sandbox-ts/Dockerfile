# Use Debian-based Node image for Puppeteer compatibility
FROM node:18-slim

# Install Chromium and dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set environment variable for Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Set up the working directory for the sandbox server code
WORKDIR /usr/src/app

# Copy package files and install dependencies for the server itself
COPY package*.json ./
RUN npm install

# Copy the server source code
COPY src ./src
COPY tsconfig.json ./
COPY build.js ./

# Compile the TypeScript server
RUN npm run build

# Create the sandbox working directory
RUN mkdir -p /usr/src/sandbox

# Globally install tsx and typescript for the sandbox to use
RUN npm install -g tsx typescript

# Initialize a package.json in the sandbox directory
RUN cd /usr/src/sandbox && npm init -y

# Expose the port the server will run on
EXPOSE 3000

# Command to start the server
CMD ["node", "dist/index.js"]
