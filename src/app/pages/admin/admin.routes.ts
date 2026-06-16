import { type Routes } from '@angular/router';
import { AdminLayoutComponent } from './components/admin-layout/admin-layout';
import { AdminDashboardComponent } from './dashboard/admin-dashboard';
import { AdminUsersComponent } from './users/admin-users';
import { AdminUserProfileComponent } from './user-profile/admin-user-profile';
import { AdminAuditLogsComponent } from './audit-logs/admin-audit-logs';

export const adminRoutes: Routes = [
  {
    path: '',
    component: AdminLayoutComponent,
    children: [
      {
        path: 'dashboard',
        component: AdminDashboardComponent
      },
      {
        path: 'users',
        component: AdminUsersComponent
      },
      {
        path: 'user-profile/:id',
        component: AdminUserProfileComponent
      },
      {
        path: 'audit-logs',
        component: AdminAuditLogsComponent
      },
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      }
    ]
  }
];
