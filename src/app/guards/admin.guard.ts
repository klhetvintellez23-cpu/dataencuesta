import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { AdminDataService } from '../services/admin-data.service';

export const adminGuard: CanActivateFn = async (route, state) => {
  const supabaseService = inject(SupabaseService);
  const adminData = inject(AdminDataService);
  const router = inject(Router);

  const supabase = supabaseService.client;
  if (!supabase) {
    return router.parseUrl('/');
  }

  // Await session resolution directly from Supabase (reads localStorage + refreshes
  // token if needed) instead of relying on the auth signal, which may not have been
  // populated yet by onAuthStateChange on hard refresh / direct URL navigation.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    return router.parseUrl('/');
  }

  const isAdmin = await adminData.checkIsAdmin(session.user.id);
  return isAdmin ? true : router.parseUrl('/dashboard');
};
