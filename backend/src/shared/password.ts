/**
 * Password hashing.
 *
 * Spec section 11.5: never plaintext, never plain MD5/SHA, Argon2id or bcrypt
 * with safe parameters. Parameters below follow the current OWASP baseline for
 * Argon2id (19 MiB memory, 2 iterations, 1 lane).
 *
 * The parameters are embedded in the resulting hash string, so raising them
 * later does not invalidate existing hashes — old passwords keep verifying and
 * can be re-hashed on next successful login if that is ever wanted.
 */
import argon2 from 'argon2';

const OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, OPTIONS);
}

/**
 * Verifies a password. Returns false rather than throwing on a malformed or
 * unrecognised hash, so a corrupt row cannot turn a failed login into a 500.
 */
export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
