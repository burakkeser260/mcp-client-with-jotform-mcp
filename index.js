#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JotformMCPClient } from './jotform-mcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse CLI args
const args = process.argv.slice(2);
let mcpUrl = 'https://mcp.jotform.com/chatgpt';
let endpointName = 'chatgpt';

if (args.includes('--chatgpt')) {
  mcpUrl = 'https://mcp.jotform.com/chatgpt';
  endpointName = 'chatgpt';
} else if (args.includes('--chatgpt-app')) {
  mcpUrl = 'https://mcp.jotform.com/chatgpt-app';
  endpointName = 'chatgpt-app';
} else if (args.includes('--default')) {
  mcpUrl = 'https://mcp.jotform.com';
  endpointName = 'default';
}

const OUTPUT_FILE = path.join(__dirname, `output-${endpointName}.json`);

// Output collector
const output = {
  timestamp: new Date().toISOString(),
  endpoint: endpointName,
  mcpUrl: mcpUrl,
  session: null,
  tools: [],
  errors: []
};

function saveOutput() {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  log('Starting Jotform MCP Client...');
  log(`Endpoint: ${endpointName}`);
  log(`MCP URL: ${mcpUrl}`);
  
  const client = new JotformMCPClient(mcpUrl);
  
  try {
    log('Connecting to Jotform MCP...');
    await client.connect();
    
    output.session = {
      id: client.sessionId,
      connected: true,
      connectedAt: new Date().toISOString()
    };
    
    log(`Connected! Session: ${client.sessionId}`);
    log(`Found ${client.tools.length} tools`);
    
    output.tools = client.tools;
    saveOutput();
    
    log(`Output saved to output-${endpointName}.json`);
    process.exit(0);
    
  } catch (err) {
    log(`Error: ${err.message}`);
    output.errors.push({
      timestamp: new Date().toISOString(),
      message: err.message,
      stack: err.stack
    });
    saveOutput();
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  log('Shutting down...');
  saveOutput();
  process.exit(0);
});

main();
