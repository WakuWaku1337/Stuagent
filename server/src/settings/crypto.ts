import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { hostname, userInfo } from 'node:os';

function deriveKey(): Buffer {
  const machine = `${hostname()}|${userInfo().username}|edupi-local-settings-v1|${process.env.EDUPI_SETTINGS_SECRET ?? ''}`;
  return scryptSync(machine, 'edupi-model-settings', 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptSecret(payload: string): string {
  const [ivPart, tagPart, dataPart] = payload.split('.');
  if (!ivPart || !tagPart || !dataPart) throw new Error('密钥格式无效，请重新保存');
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('无法解密密钥（可能更换了设备或系统账号），请重新保存');
  }
}

export function maskSecret(secret: string): string {
  if (!secret) return '未配置';
  if (secret.length <= 8) return '••••••••';
  return `${secret.slice(0, 3)}••••••${secret.slice(-4)}`;
}