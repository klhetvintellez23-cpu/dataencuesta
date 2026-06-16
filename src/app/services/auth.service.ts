import { computed, inject, Injectable } from '@angular/core';
import { AuthError } from '@supabase/supabase-js';
import { AuthSessionService } from './auth-session.service';
import { SupabaseService } from './supabase.service';

export interface User {
  id: string;
  name: string;
  email: string;
}

interface LoginAttemptState {
  count: number;
  lockedUntil: number;
}

const LOGIN_ATTEMPTS_PREFIX = 'login_attempts_';
const MAX_LOGIN_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 5 * 60_000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabaseService = inject(SupabaseService);
  private readonly sessionService = inject(AuthSessionService);
  private readonly supabase = this.supabaseService.client;

  readonly user = this.sessionService.user;
  readonly isLoggedIn = computed(() => this.sessionService.user() !== null);
  readonly isAvailable = this.supabaseService.isConfigured;

  constructor() {
    this.initializeSession();
  }

  private initializeSession(): void {
    this.sessionService.initialize(this.supabase);
  }

  async loginWithGoogle(): Promise<{ success: boolean; error?: string }> {
    if (!this.supabase) return { success: false, error: 'Falta configurar Supabase en public/env.js.' };

    const { error } = await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`
      }
    });

    if (error) return { success: false, error: this.mapError(error) };
    return { success: true };
  }

  async login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    if (!this.supabase) return { success: false, error: 'Falta configurar Supabase en public/env.js.' };

    const throttle = this.checkLoginThrottle(email);
    if (!throttle.allowed) {
      return { success: false, error: `Demasiados intentos fallidos. Intenta de nuevo en ${throttle.remainingSeconds} segundos.` };
    }

    const { error } = await this.supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      this.registerFailedLoginAttempt(email);
      return { success: false, error: this.mapError(error) };
    }

    this.resetLoginAttempts(email);
    return { success: true };
  }

  private getLoginAttemptState(email: string): LoginAttemptState {
    try {
      const raw = localStorage.getItem(LOGIN_ATTEMPTS_PREFIX + email.trim().toLowerCase());
      if (!raw) return { count: 0, lockedUntil: 0 };
      return JSON.parse(raw) as LoginAttemptState;
    } catch {
      return { count: 0, lockedUntil: 0 };
    }
  }

  private saveLoginAttemptState(email: string, state: LoginAttemptState): void {
    localStorage.setItem(LOGIN_ATTEMPTS_PREFIX + email.trim().toLowerCase(), JSON.stringify(state));
  }

  private checkLoginThrottle(email: string): { allowed: boolean; remainingSeconds: number } {
    const { lockedUntil } = this.getLoginAttemptState(email);
    const remainingMs = lockedUntil - Date.now();

    if (remainingMs > 0) return { allowed: false, remainingSeconds: Math.ceil(remainingMs / 1000) };
    return { allowed: true, remainingSeconds: 0 };
  }

  private registerFailedLoginAttempt(email: string): void {
    const state = this.getLoginAttemptState(email);
    const count = state.count + 1;
    let lockedUntil = state.lockedUntil;

    if (count >= MAX_LOGIN_ATTEMPTS) {
      const lockoutMs = Math.min(BASE_LOCKOUT_MS * 2 ** (count - MAX_LOGIN_ATTEMPTS), MAX_LOCKOUT_MS);
      lockedUntil = Date.now() + lockoutMs;
    }

    this.saveLoginAttemptState(email, { count, lockedUntil });
  }

  private resetLoginAttempts(email: string): void {
    localStorage.removeItem(LOGIN_ATTEMPTS_PREFIX + email.trim().toLowerCase());
  }

  async register(name: string, email: string, password: string): Promise<{ success: boolean; error?: string }> {
    if (!this.supabase) return { success: false, error: 'Falta configurar Supabase en public/env.js.' };

    const { error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name.trim()
        }
      }
    });

    if (error) return { success: false, error: this.mapError(error) };
    return { success: true };
  }

  async verifyCode(email: string, token: string): Promise<{ success: boolean; error?: string }> {
    if (!this.supabase) return { success: false, error: 'Falta configurar Supabase en public/env.js.' };

    const { data, error } = await this.supabase.auth.verifyOtp({
      email,
      token,
      type: 'signup'
    });

    if (error) return { success: false, error: this.mapError(error) };

    this.sessionService.updateUser(data.user ?? null);
    return { success: true };
  }

  private mapError(error: AuthError | Error): string {
    const message = (error.message || '').toLowerCase();

    if (message.includes('invalid login credentials')) return 'Credenciales inválidas. Revisa tu correo y contraseña.';
    if (message.includes('email not confirmed')) return 'Debes confirmar tu correo electrónico antes de entrar.';
    if (message.includes('email already registered') || message.includes('user already registered')) return 'Este correo ya está registrado. Intenta iniciar sesión.';
    if (message.includes('rate limit exceeded') || message.includes('too many requests')) return 'Se ha superado el límite de solicitudes. Intenta de nuevo en unos minutos.';
    if (message.includes('password should be at least')) return 'La contraseña debe tener al menos 6 caracteres.';
    if (message.includes('signup is disabled')) return 'El registro está deshabilitado temporalmente.';
    if (message.includes('token has expired') || message.includes('otp expired')) return 'El código de verificación expiró. Solicita uno nuevo.';
    if (message.includes('token is invalid') || message.includes('otp')) return 'El código de verificación no es válido.';

    return `Ocurrió un error: ${error.message}`;
  }

  async logout(): Promise<void> {
    if (!this.supabase) {
      this.sessionService.clear();
      return;
    }

    await this.supabase.auth.signOut();
    this.sessionService.clear();
  }
}
