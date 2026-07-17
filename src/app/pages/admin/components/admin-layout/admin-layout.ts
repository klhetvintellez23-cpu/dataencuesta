import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterOutlet, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../../services/auth.service';
import { AdminDataService, type AdminUser } from '../../../../services/admin-data.service';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterOutlet, RouterLinkActive],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.css'
})
export class AdminLayoutComponent implements OnInit {
  public readonly auth = inject(AuthService);
  private readonly adminDataService = inject(AdminDataService);
  public readonly router = inject(Router);

  // Derive admin profile details from logged-in user
  readonly adminProfile = computed<AdminUser | null>(() => {
    const user = this.auth.user();
    if (!user) return null;
    return this.adminDataService.users().find(
      u => u.email.toLowerCase() === user.email.toLowerCase()
    ) || null;
  });

  ngOnInit(): void {
    // Carga el listado de usuarios/encuestas y la auditoría real para
    // todas las vistas del panel /admin (protegido por adminGuard + RLS).
    void this.adminDataService.loadRealData();
    void this.adminDataService.loadAuditLogs();
  }

  readonly showMobileSidebar = signal<boolean>(false);
  readonly showUserDropdown = signal<boolean>(false);

  toggleMobileSidebar(): void {
    this.showMobileSidebar.update(v => !v);
  }

  toggleUserDropdown(event: Event): void {
    event.stopPropagation();
    this.showUserDropdown.update(v => !v);
  }

  closeUserDropdown(): void {
    this.showUserDropdown.set(false);
  }

  logout(): void {
    void this.auth.logout();
    void this.router.navigate(['/']);
  }
}
