import { Injectable, signal } from '@angular/core';
import { User as SupabaseUser, type SupabaseClient } from '@supabase/supabase-js';
import type { User } from './auth.service';

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly currentUser = signal<User | null>(null);

  readonly user = this.currentUser.asReadonly();

  initialize(client: SupabaseClient | null): void {
    if (!client) {
      this.currentUser.set(null);
      return;
    }

    client.auth.onAuthStateChange((event, session) => {
      this.updateUser(session?.user ?? null);

      // No hay trigger en este repo que garantice una fila en `perfiles` para
      // usuarios nuevos (ni por email ni por Google). Si esa fila no existe,
      // crear una encuesta falla por la FK usuario_id -> perfiles.id con un
      // error genérico de "base de datos". La creamos aquí de forma
      // idempotente (upsert) apenas hay sesión, sin pisar rol/estado si ya
      // existía.
      if (event === 'SIGNED_IN' && session?.user) {
        void this.ensureProfile(client, session.user);
      }
    });
  }

  private async ensureProfile(client: SupabaseClient, user: SupabaseUser): Promise<void> {
    try {
      const { error } = await client.from('perfiles').upsert(
        {
          id: user.id,
          email: user.email ?? '',
          nombre_completo: user.user_metadata?.['full_name'] || user.email?.split('@')[0] || 'Usuario'
        },
        { onConflict: 'id' }
      );
      if (error) {
        console.error('No se pudo asegurar el perfil del usuario:', error);
      }
    } catch (error) {
      console.error('No se pudo asegurar el perfil del usuario:', error);
    }
  }

  updateUser(sbUser: SupabaseUser | null): void {
    if (sbUser) {
      this.currentUser.set({
        id: sbUser.id,
        name: sbUser.user_metadata?.['full_name'] || sbUser.email?.split('@')[0] || 'User',
        email: sbUser.email || ''
      });
      return;
    }

    this.currentUser.set(null);
  }

  clear(): void {
    this.currentUser.set(null);
  }
}
