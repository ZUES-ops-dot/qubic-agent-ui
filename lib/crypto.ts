// Encryption for API keys and secrets in localStorage
// Uses AES-GCM via Web Crypto API (real encryption) with PBKDF2 key derivation.
// Falls back to XOR obfuscation when Web Crypto is unavailable (SSR, old browsers).
// Backward-compatible: reads legacy apiv1:/encv1: XOR format, writes new aesv1: format.

const LEGACY_XOR_KEY = 'qubic-agent-v1';
const LEGACY_API_PREFIX = 'apiv1:';
const LEGACY_SECRET_PREFIX = 'encv1:';
const AES_PREFIX = 'aesv1:';

// Unique per-browser salt stored alongside encrypted data
const SALT_KEY = 'qubic-agent-salt';

function getSalt(): Uint8Array {
  if (typeof window === 'undefined') return new Uint8Array(16);
  let stored = localStorage.getItem(SALT_KEY);
  if (!stored) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    stored = btoa(String.fromCharCode(...salt));
    localStorage.setItem(SALT_KEY, stored);
  }
  return Uint8Array.from(atob(stored), c => c.charCodeAt(0));
}

// ── Web Crypto AES-GCM ───────────────────────────────────────────────────────

function hasWebCrypto(): boolean {
  return typeof window !== 'undefined' && typeof crypto?.subtle?.deriveKey === 'function';
}

async function deriveAesKey(salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder().encode('qubic-forge-aes-v1');
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.buffer as ArrayBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function aesEncrypt(plaintext: string): Promise<string> {
  const salt = getSalt();
  const key = await deriveAesKey(salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  // Pack iv + ciphertext into a single base64 string
  const packed = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), iv.length);
  return AES_PREFIX + btoa(String.fromCharCode(...packed));
}

async function aesDecrypt(stored: string): Promise<string> {
  const payload = stored.slice(AES_PREFIX.length);
  const packed = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  const salt = getSalt();
  const key = await deriveAesKey(salt);
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plainBuffer);
}

// ── Legacy XOR (read-only for migration) ──────────────────────────────────────

function xorEncrypt(text: string, key: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

function legacyDecryptApiKey(stored: string): string {
  const payload = stored.startsWith(LEGACY_API_PREFIX)
    ? stored.slice(LEGACY_API_PREFIX.length)
    : stored;
  try {
    const decoded = typeof atob !== 'undefined'
      ? decodeURIComponent(atob(payload))
      : decodeURIComponent(Buffer.from(payload, 'base64').toString());
    return xorEncrypt(decoded, LEGACY_XOR_KEY);
  } catch {
    return stored;
  }
}

function legacyDecryptSecret(stored: string): string {
  const payload = stored.slice(LEGACY_SECRET_PREFIX.length);
  try {
    const decoded = typeof atob !== 'undefined'
      ? decodeURIComponent(atob(payload))
      : decodeURIComponent(Buffer.from(payload, 'base64').toString());
    return xorEncrypt(decoded, LEGACY_XOR_KEY);
  } catch {
    return stored;
  }
}

function legacyXorEncrypt(text: string, prefix: string): string {
  try {
    const encrypted = xorEncrypt(text, LEGACY_XOR_KEY);
    return prefix + btoa(encodeURIComponent(encrypted));
  } catch {
    return text;
  }
}

// ── Public API (sync, backward-compatible) ────────────────────────────────────

export function encryptApiKey(apiKey: string): string {
  if (!apiKey) return '';
  if (apiKey.startsWith(AES_PREFIX) || apiKey.startsWith(LEGACY_API_PREFIX)) return apiKey;
  if (hasWebCrypto()) {
    // Fire-and-forget: start async AES encryption, return XOR for now
    // The storage layer will upgrade to AES on next read/write cycle
    aesEncrypt(apiKey).then(encrypted => {
      // Store the AES version if settings still contain this key
      try {
        const raw = localStorage.getItem('qubic-agent-settings');
        if (raw) {
          const obj = JSON.parse(raw);
          // Upgrade any field that matches the XOR version
          const xorVersion = legacyXorEncrypt(apiKey, LEGACY_API_PREFIX);
          for (const field of ['apiKey', 'googleApiKey']) {
            if (obj[field] === xorVersion) {
              obj[field] = encrypted;
            }
          }
          localStorage.setItem('qubic-agent-settings', JSON.stringify(obj));
        }
      } catch { /* best-effort upgrade */ }
    }).catch(() => { /* keep XOR fallback */ });
  }
  return legacyXorEncrypt(apiKey, LEGACY_API_PREFIX);
}

export function encryptStoredSecret(secret: string): string {
  if (!secret) return '';
  if (secret.startsWith(AES_PREFIX) || secret.startsWith(LEGACY_SECRET_PREFIX)) return secret;
  if (hasWebCrypto()) {
    aesEncrypt(secret).then(encrypted => {
      try {
        const raw = localStorage.getItem('qubic-agent-settings');
        if (raw) {
          const obj = JSON.parse(raw);
          const xorVersion = legacyXorEncrypt(secret, LEGACY_SECRET_PREFIX);
          for (const field of ['oracleToolkitToken', 'devkitBridgeToken']) {
            if (obj[field] === xorVersion) {
              obj[field] = encrypted;
            }
          }
          localStorage.setItem('qubic-agent-settings', JSON.stringify(obj));
        }
      } catch { /* best-effort */ }
    }).catch(() => {});
  }
  return legacyXorEncrypt(secret, LEGACY_SECRET_PREFIX);
}

export function decryptApiKey(encryptedKey: string): string {
  if (!encryptedKey) return '';
  // AES-encrypted keys need async decryption — handled by decryptApiKeyAsync
  if (encryptedKey.startsWith(AES_PREFIX)) {
    // Sync fallback: return empty and let async path handle it
    // This shouldn't happen in practice because getSettings calls decryptApiKeyAsync
    return '';
  }
  if (encryptedKey.startsWith(LEGACY_API_PREFIX)) {
    return legacyDecryptApiKey(encryptedKey);
  }
  // Try legacy decode for old format
  return legacyDecryptApiKey(encryptedKey);
}

export function decryptStoredSecret(storedValue: string): string {
  if (!storedValue) return '';
  if (storedValue.startsWith(AES_PREFIX)) return '';
  if (storedValue.startsWith(LEGACY_SECRET_PREFIX)) return legacyDecryptSecret(storedValue);
  return storedValue;
}

// Async decryption for AES values — called by storage layer
export async function decryptApiKeyAsync(encryptedKey: string): Promise<string> {
  if (!encryptedKey) return '';
  if (encryptedKey.startsWith(AES_PREFIX)) {
    try {
      return await aesDecrypt(encryptedKey);
    } catch (e) {
      console.warn('AES decryption failed:', e);
      return '';
    }
  }
  return decryptApiKey(encryptedKey);
}

export async function decryptStoredSecretAsync(storedValue: string): Promise<string> {
  if (!storedValue) return '';
  if (storedValue.startsWith(AES_PREFIX)) {
    try {
      return await aesDecrypt(storedValue);
    } catch {
      return '';
    }
  }
  return decryptStoredSecret(storedValue);
}

export function isEncrypted(value: string): boolean {
  if (!value) return false;
  if (value.startsWith(AES_PREFIX)) return true;
  if (value.startsWith(LEGACY_API_PREFIX)) return true;
  if (value.startsWith(LEGACY_SECRET_PREFIX)) return true;
  if (value.startsWith('sk-') || value.startsWith('AIza')) return false;
  if (!/^[A-Za-z0-9+/=]{16,}$/.test(value)) return false;
  try {
    const decoded = typeof atob !== 'undefined'
      ? atob(value)
      : Buffer.from(value, 'base64').toString();
    return /%[0-9A-Fa-f]{2}/.test(decoded);
  } catch {
    return false;
  }
}

export function isValidApiKeyFormat(key: string): boolean {
  return /^sk-[a-zA-Z0-9]{32,}$/.test(key) || /^AIza[A-Za-z0-9_-]{30,}$/.test(key);
}

// Sanitize input to prevent XSS
export function sanitizeInput(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Sanitize code input (less aggressive, preserve code structure)
export function sanitizeCodeInput(code: string): string {
  // Remove potential script injections but preserve code syntax
  return code
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
}
