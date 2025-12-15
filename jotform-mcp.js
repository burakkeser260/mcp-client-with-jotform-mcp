/**
 * Jotform MCP Client with OAuth
 */

import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'db');

// Simple KV store for OAuth tokens
const kv = {
  _ensureDir() {
    if (!fs.existsSync(DB_PATH)) {
      fs.mkdirSync(DB_PATH, { recursive: true });
    }
  },
  _getPath(key) {
    return path.join(DB_PATH, `${key}.json`);
  },
  get(key, defaultValue = null) {
    this._ensureDir();
    const filePath = this._getPath(key);
    if (!fs.existsSync(filePath)) return defaultValue;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return defaultValue;
    }
  },
  set(key, value) {
    this._ensureDir();
    fs.writeFileSync(this._getPath(key), JSON.stringify(value, null, 2));
    return value;
  },
  delete(key) {
    const filePath = this._getPath(key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }
};

// OAuth Client
class OAuthClient {
  constructor(mcpUrl, localPort = 8976) {
    this.mcpUrl = mcpUrl;
    this.localPort = localPort;
    this.redirectUri = `http://localhost:${localPort}/callback`;
  }

  generateState() {
    return crypto.randomBytes(16).toString('hex');
  }

  generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
  }

  generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  async discoverOAuthEndpoints() {
    try {
      const response = await fetch(new URL('/.well-known/oauth-authorization-server', this.mcpUrl).toString());
      if (response.ok) return await response.json();
    } catch {}
    return {
      authorization_endpoint: `${this.mcpUrl}/authorize`,
      token_endpoint: `${this.mcpUrl}/token`,
      registration_endpoint: `${this.mcpUrl}/register`
    };
  }

  async registerClient(endpoints) {
    const cached = kv.get('jotform_mcp_client');
    if (cached?.client_id) return cached;

    const response = await fetch(endpoints.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Local MCP Client',
        redirect_uris: [this.redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none'
      })
    });

    if (!response.ok) throw new Error(`Registration failed: ${await response.text()}`);
    const clientInfo = await response.json();
    kv.set('jotform_mcp_client', clientInfo);
    return clientInfo;
  }

  startCallbackServer(state, codeVerifier, endpoints, clientInfo) {
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:${this.localPort}`);
        
        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const returnedState = url.searchParams.get('state');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<h1>Error: ${error}</h1>`);
            server.close();
            reject(new Error(error));
            return;
          }

          if (returnedState !== state) {
            res.writeHead(400);
            res.end('State mismatch');
            server.close();
            reject(new Error('State mismatch'));
            return;
          }

          try {
            const tokens = await this.exchangeCodeForTokens(code, codeVerifier, endpoints, clientInfo);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Success! You can close this window.</h1>');
            server.close();
            resolve(tokens);
          } catch (err) {
            res.writeHead(500);
            res.end(`Error: ${err.message}`);
            server.close();
            reject(err);
          }
        }
      });

      server.listen(this.localPort);
      setTimeout(() => { server.close(); reject(new Error('Timeout')); }, 300000);
    });
  }

  async exchangeCodeForTokens(code, codeVerifier, endpoints, clientInfo) {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: clientInfo.client_id,
      code_verifier: codeVerifier
    });

    const response = await fetch(endpoints.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) throw new Error(`Token exchange failed: ${await response.text()}`);
    const tokens = await response.json();
    const tokenData = { ...tokens, obtained_at: Date.now(), expires_at: tokens.expires_in ? Date.now() + (tokens.expires_in * 1000) : null };
    kv.set('jotform_mcp_tokens', tokenData);
    return tokenData;
  }

  async getAccessToken() {
    const tokens = kv.get('jotform_mcp_tokens');
    if (!tokens?.access_token) return null;
    if (tokens.expires_at && Date.now() > tokens.expires_at - 300000) {
      const endpoints = await this.discoverOAuthEndpoints();
      const clientInfo = kv.get('jotform_mcp_client');
      return await this.refreshTokens(endpoints, clientInfo);
    }
    return tokens;
  }

  async refreshTokens(endpoints, clientInfo) {
    const tokens = kv.get('jotform_mcp_tokens');
    if (!tokens?.refresh_token) throw new Error('No refresh token');

    const response = await fetch(endpoints.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientInfo.client_id
      }).toString()
    });

    if (!response.ok) {
      kv.delete('jotform_mcp_tokens');
      throw new Error('Token refresh failed');
    }

    const newTokens = await response.json();
    const tokenData = {
      ...newTokens,
      refresh_token: newTokens.refresh_token || tokens.refresh_token,
      obtained_at: Date.now(),
      expires_at: newTokens.expires_in ? Date.now() + (newTokens.expires_in * 1000) : null
    };
    kv.set('jotform_mcp_tokens', tokenData);
    return tokenData;
  }

  async authorize() {
    console.log('Starting OAuth...');
    const endpoints = await this.discoverOAuthEndpoints();
    const clientInfo = await this.registerClient(endpoints);
    
    const state = this.generateState();
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    const authUrl = new URL(endpoints.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientInfo.client_id);
    authUrl.searchParams.set('redirect_uri', this.redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    console.log('\n========================================');
    console.log('Open this URL in your browser:');
    console.log(authUrl.toString());
    console.log('========================================\n');

    // Try to open browser
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
      const { exec } = await import('child_process');
      exec(`${cmd} "${authUrl.toString()}"`);
    } catch {}

    return await this.startCallbackServer(state, codeVerifier, endpoints, clientInfo);
  }
}

// Jotform MCP Client
export class JotformMCPClient {
  constructor(mcpUrl = 'https://mcp.jotform.com/chatgpt') {
    this.mcpUrl = mcpUrl;
    this.oauth = new OAuthClient(mcpUrl);
    this.tools = [];
    this.sessionId = null;
    this.messageEndpoint = null;
  }

  async connect() {
    let tokens = await this.oauth.getAccessToken();
    if (!tokens) {
      tokens = await this.oauth.authorize();
    }

    this.messageEndpoint = this.mcpUrl;
    await this._initializeSession(tokens.access_token);
    this._establishSSE(tokens.access_token);
    await this._sendNotification('notifications/initialized', {}, tokens.access_token);

    const toolsResponse = await this._request('tools/list', {}, tokens.access_token);
    this.tools = toolsResponse?.tools || [];
    
    console.log(`Connected! ${this.tools.length} tools available`);
    return this;
  }

  async _initializeSession(accessToken) {
    const body = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'local-mcp-client', version: '1.0.0' }
      }
    };

    const response = await fetch(this.messageEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) throw new Error(`Initialize failed: ${await response.text()}`);

    this.sessionId = response.headers.get('mcp-session-id');
    if (!this.sessionId) {
      const text = await response.text();
      const match = text.match(/mcp-session-id[:\s"]+([a-f0-9-]+)/i);
      if (match) this.sessionId = match[1];
    }

    if (!this.sessionId) throw new Error('No session ID returned');
    console.log(`Session: ${this.sessionId}`);
  }

  _establishSSE(accessToken) {
    fetch(this.mcpUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Authorization': `Bearer ${accessToken}`,
        'mcp-session-id': this.sessionId
      }
    }).catch(() => {});
  }

  async _sendNotification(method, params, accessToken) {
    await fetch(this.messageEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${accessToken}`,
        'mcp-session-id': this.sessionId
      },
      body: JSON.stringify({ jsonrpc: '2.0', method, params })
    });
  }

  async _request(method, params, accessToken) {
    if (!accessToken) {
      const tokens = await this.oauth.getAccessToken();
      if (!tokens) throw new Error('Not authorized');
      accessToken = tokens.access_token;
    }

    const body = { jsonrpc: '2.0', id: Date.now(), method, params };

    const response = await fetch(this.messageEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${accessToken}`,
        'mcp-session-id': this.sessionId
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) throw new Error(`Request failed: ${await response.text()}`);

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      return this._parseSSE(await response.text());
    }

    const result = await response.json();
    if (result.error) throw new Error(result.error.message);
    return result.result;
  }

  _parseSSE(text) {
    let result = null;
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.result !== undefined) result = parsed.result;
          if (parsed.error) throw new Error(parsed.error.message);
        } catch (e) {
          if (e.message.includes('error')) throw e;
        }
      }
    }
    return result;
  }

  async callTool(name, args = {}) {
    return await this._request('tools/call', { name, arguments: args });
  }
}

export default JotformMCPClient;
