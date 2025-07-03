# Use Node.js official image
FROM node:20

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Expose the port
EXPOSE 3000

# Start the app
CMD ["node", "server.js"]
