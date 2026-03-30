import { Injectable, Logger } from '@nestjs/common';
import { resolveMx } from 'dns/promises';
import { DISPOSABLE_EMAIL_DOMAINS } from '../common/constants/email-validation.constants';

export interface EmailValidationResult {
  valid: boolean;
  reason?: string;
}

@Injectable()
export class EmailValidatorService {
  private readonly logger = new Logger(EmailValidatorService.name);

  /** MX lookup cache: domain → boolean (has MX records) */
  private readonly mxCache = new Map<string, { value: boolean; expiresAt: number }>();
  private readonly MX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Validate an email address before sending it to Supabase for sign-up.
   * Checks:
   *  1. Basic format
   *  2. Subaddressing (+ aliases) rejection
   *  3. Disposable / throwaway domain blocklist
   *  4. DNS MX record lookup (domain can actually receive mail)
   */
  async validate(email: string): Promise<EmailValidationResult> {
    const normalised = email.trim().toLowerCase();

    // 1. Basic format
    const atIdx = normalised.lastIndexOf('@');
    if (atIdx < 1) {
      return { valid: false, reason: 'Invalid email format.' };
    }

    const localPart = normalised.slice(0, atIdx);
    const domain = normalised.slice(atIdx + 1);

    if (!domain || !domain.includes('.')) {
      return { valid: false, reason: 'Invalid email domain.' };
    }

    // 2. Subaddressing check (plus addressing)
    if (localPart.includes('+')) {
      return {
        valid: false,
        reason: 'Email subaddressing (+ addresses) is not allowed. Please use your base email address.',
      };
    }

    // 3. Disposable domain check
    if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
      return {
        valid: false,
        reason: 'Disposable email addresses are not allowed. Please use a permanent email address.',
      };
    }

    // 4. MX record lookup — verify the domain can receive email
    const hasMx = await this.checkMx(domain);
    if (!hasMx) {
      return {
        valid: false,
        reason: `The domain "${domain}" does not appear to accept email. Please check for typos.`,
      };
    }

    return { valid: true };
  }

  /**
   * DNS MX lookup with caching.
   * Returns true if the domain has at least one MX record (or an A record fallback).
   */
  private async checkMx(domain: string): Promise<boolean> {
    // Check cache first
    const cached = this.mxCache.get(domain);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      const records = await resolveMx(domain);
      const hasMx = records.length > 0;
      this.cacheResult(domain, hasMx);
      return hasMx;
    } catch (err: any) {
      // ENODATA / ENOTFOUND means no MX records
      if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
        this.cacheResult(domain, false);
        return false;
      }

      // For transient DNS errors (ETIMEOUT, ESERVFAIL), give benefit of the doubt
      this.logger.warn(`MX lookup failed for ${domain}: ${err.code ?? err.message}`);
      return true;
    }
  }

  private cacheResult(domain: string, value: boolean) {
    this.mxCache.set(domain, {
      value,
      expiresAt: Date.now() + this.MX_CACHE_TTL_MS,
    });

    // Prevent unbounded cache growth
    if (this.mxCache.size > 10_000) {
      const oldest = this.mxCache.keys().next().value;
      if (oldest) this.mxCache.delete(oldest);
    }
  }
}
